/**
 * iOS 的依赖通道: SDK 与三方库统一交给 uniapp.podspec, 工程结构仍由 XcodeGen 生成。
 *
 * - 模块 -> subspec 的映射在这里 (podSubspecs), base.yml 不再维护手写依赖表;
 * - 要求 SDK 根目录是完整离线包 (含 uniapp.podspec 与 SDK/), 找不到就报错, 不退回手写依赖;
 * - iosModules.js 仍用于隐私文案/权限/feature.plist 校验, 但它的依赖注入会被跳过。
 */

import fs from 'fs'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { execSync } from 'child_process'

const PODSPEC_NAME = 'uniapp.podspec'
// 恒带的 subspec: 这些模块在 manifest 里没有勾选入口 (uni-app「App功能模块」表只列了 24 个可勾选模块),
// 云打包和 Android 的 lib.5plus.base-release.aar 都无条件包含 (见 src/androidModules.js 顶部),
// iOS 把同一批能力拆成独立静态库, 只按 modules 生成就会漏, 运行期一调用即弹「打包时未添加 XX 模块」
const BASE_SUBSPECS = [
  'Core',
  'File', // plus.io, 启动即用
  'XMLHttpRequest', // plus.net, uni.request 的底层实现
  'Zip', // plus.zip / uni.compressImage
  'Log', // plus.console
  'Audio' // plus.audio, uni.createInnerAudioContext 等
]
// 云打包默认带、但业务很少直接调用的模块: 不进 BASE_SUBSPECS, 由 writePodfile 以注释形式写进生成的
// Podfile, 用户在工程里取消注释即可启用。Accelerometer 需要的 CoreMotion.framework 由
// src/cli.js 的 syncIOSSystemFrameworks 按所选 subspec 动态补进 config/base.yml
const OPTIONAL_SUBSPECS = {
  Accelerometer: '摇一摇 / 计步',
  Proximity: '距离感应 (贴近听筒熄屏)'
}
// 这些 subspec 的实现里引用了 CoreMotion 的类, 但官方 podspec 没声明该框架 (Accelerometer 只写了 Accelerate),
// 工程开了 -ObjC 就必须由 target 补链接。Orientation 的 podspec 已声明, 一并归入, 重复链接无副作用。
// 只有当前 subspecs 命中这里时才在 config/base.yml 写 CoreMotion.framework, 不再无条件链接。
export const CORE_MOTION_SUBSPECS = [
  'Accelerometer',
  'Orientation',
  'Payment-AliPay',
  'Payment-Paypal',
  'Geolocation-Tencent'
]
// manifest 的 app-plus.modules 标识 -> podspec 里的基础 subspec
const MODULE_SUBSPECS = {
  Accelerometer: 'Accelerometer',
  Audio: 'Audio',
  Barcode: 'Barcode',
  Bluetooth: 'BlueTooth',
  Camera: 'CameraGallery',
  Canvas: 'Canvas',
  Contact: 'Contacts',
  Contacts: 'Contacts',
  FaceID: 'FaceId',
  // 实人认证: HBuilderX 3.7.4+ 的「App模块配置」里有, 但没进 app-modules 那张可勾选表
  FacialRecognitionVerify: 'FacialRecognitionVerify',
  File: 'File',
  Fingerprint: 'Fingerprint',
  iBeacon: 'IBeacon',
  LivePusher: 'LivePusher',
  Log: 'Log',
  Messaging: 'Messaging',
  Orientation: 'Orientation',
  Proximity: 'Proximity',
  Record: 'Audio',
  SQLite: 'Sqlite',
  UIWebview: 'UIWebview',
  VideoPlayer: 'Video',
  XMLHttpRequest: 'XMLHttpRequest',
  Zip: 'Zip',
}

// 需要 sdkConfigs 判定 provider 的模块: manifest 模块标识 -> sdkConfigs 键
const MODULE_CATEGORIES = {
  Geolocation: 'geolocation',
  Maps: 'maps',
  OAuth: 'oauth',
  Payment: 'payment',
  Push: 'push',
  Share: 'share',
  Speech: 'speech',
  Statistic: 'statics',
}

// sdkConfigs 里 provider -> podspec subspec; 没有 base 的类别必须按 provider 选
const CATEGORY_SUBSPECS = {
  // system 是系统定位 (内置), 等于 base subspec 自带, 不该告警
  geolocation: { base: 'Geolocation', system: 'Geolocation', baidu: 'Geolocation-Baidu', amap: 'Geolocation-Gaode', tencent: 'Geolocation-Tencent' },
  maps: { baidu: 'Map-Baidu', amap: 'Map-Gaode', google: 'Map-Google' },
  oauth: { base: 'Oauth', univerify: 'Oauth-Univerify', sina: 'Oauth-Sina', qq: 'Oauth-QQ', weixin: 'Oauth-Wechat', apple: 'Oauth-Apple', google: 'Oauth-Google', facebook: 'Oauth-Facebook' },
  payment: { base: 'Payment', alipay: 'Payment-AliPay', weixin: 'Payment-Wechat', appleiap: 'Payment-IAP', paypal: 'Payment-Paypal', stripe: 'Payment-Stripe' },
  push: { base: 'Push', unipush: 'Push-UniPush', getui: 'Push-Getui', igexin: 'Push-Getui', fcm: 'Push-FCM' },
  share: { base: 'Share', sina: 'Share-Sina', qq: 'Share-QQ', weixin: 'Share-Wechat' },
  speech: { base: 'Speech', baidu: 'Speech-Baidu', ifly: 'Speech-Ifly' },
  statics: { base: 'Statistic', umeng: 'Statistic-Umeng', google: 'Statistic-Firebase' },
}

// 完整离线 SDK 根目录 (含 uniapp.podspec) 才支持 Pod 模式
export function isPodSDKRoot(root) {
  return Boolean(root) && fs.existsSync(path.join(root, PODSPEC_NAME)) && fs.existsSync(path.join(root, 'SDK'))
}

// uapp 的 SDK 目录 (~/.uappsdk/ios) 常常只拷了 SDK/, 这里按需从用户指定的完整 SDK 补 uniapp.podspec 与 license.md
export function ensurePodSDKFiles({ sdkHomeDir, sourceRoot }) {
  const target = path.join(sdkHomeDir, 'ios')
  if (!isPodSDKRoot(sourceRoot)) return null
  const readVersion = (root) => {
    const file = path.join(root, 'SDK', 'control.xml')
    if (!fs.existsSync(file)) return ''
    return (/<HBuilder[^>]*\bversion="([^"]*)"/i.exec(fs.readFileSync(file, 'utf8')) || [])[1] || ''
  }
  const sourceVersion = readVersion(sourceRoot)
  const targetVersion = readVersion(target)
  fs.mkdirSync(target, { recursive: true })
  fs.copyFileSync(path.join(sourceRoot, 'uniapp.podspec'), path.join(target, 'uniapp.podspec'))
  // podspec 里 s.license = { :file => 'license.md' }, 缺这个文件 pod install 会直接失败
  const license = path.join(sourceRoot, 'license.md')
  if (fs.existsSync(license)) fs.copyFileSync(license, path.join(target, 'license.md'))
  return {
    root: isPodSDKRoot(target) ? target : null,
    sdkMissing: !fs.existsSync(path.join(target, 'SDK')),
    versionMismatch: Boolean(sourceVersion && targetVersion && sourceVersion !== targetVersion),
    sourceVersion,
    targetVersion
  }
}

export function resolvePodSDKRoot(sdkHomeDir) {
  const root = path.join(sdkHomeDir, 'ios')
  return isPodSDKRoot(root) ? root : null
}

// iOS UTS 插件目前由 buildIOSUtsYml 写 custom.yml 手工链接, Pod 模式下这条链路不成立
// manifest 的 modules/sdkConfigs -> podspec subspec 列表; 无法映射的模块只警告
export function podSubspecs({ modules, sdkConfigs }) {
  const warnings = []
  const subspecs = new Set(BASE_SUBSPECS)
  const add = (name) => {
    if (name) subspecs.add(name)
  }
  for (const moduleId of Object.keys(modules || {})) {
    const category = MODULE_CATEGORIES[moduleId]
    if (category) {
      const table = CATEGORY_SUBSPECS[category]
      const providers = Object.keys((sdkConfigs || {})[category] || {})
      // uniPush 沿用老依赖表的规则: 勾了离线推送 (offline: true) 才集成原生 SDK (GTSDK),
      // 仅在线推送走 jssdk, 与 entitlements 的 aps-environment 共用同一个开关
      if (category === 'push' && providers.includes('unipush') && sdkConfigs.push.unipush.offline !== true) {
        providers.splice(providers.indexOf('unipush'), 1)
        warnings.push('push.unipush 未勾离线推送 (offline != true): 不集成 Push-UniPush (GTSDK), 在线推送走 jssdk, 只保留 Push 基础库')
      }
      const mapped = providers.map((provider) => table[provider]).filter(Boolean)
      providers.filter((provider) => !table[provider]).forEach((provider) => {
        warnings.push(`iOS 模块 ${moduleId} 的服务商 ${provider} 没有对应的 podspec subspec, 已跳过 (如需支持请在 src/ios-pods.js 里补映射)`)
      })
      if (mapped.length) {
        mapped.forEach(add)
      } else if (table.base) {
        // 没配 provider 的三方模块: 保留基础 subspec, 由模块自己在运行时选择服务商
        add(table.base)
      } else {
        warnings.push(`iOS 模块 ${moduleId} 需要在 manifest 里配置 sdkConfigs.${category} 的服务商, 已跳过对应的 Pod subspec`)
      }
      continue
    }
    const subspec = MODULE_SUBSPECS[moduleId]
    if (subspec) {
      add(subspec)
    } else if (moduleId !== 'Webview-x5') {
      warnings.push(`iOS 模块 ${moduleId} 没有对应的 uniapp.podspec subspec, 已跳过 (如需支持请在 src/ios-pods.js 里补映射)`)
    }
  }
  // 支付和登录/分享同时开微信时, 微信登录/分享必须换成 PaySDK 变体:
  // Oauth-Wechat/Share-Wechat 链 libWeChatSDK.a, Payment-Wechat 链 libWeChatSDK_pay.a, 两份符号重复会链接失败
  if (subspecs.has('Payment-Wechat')) {
    if (subspecs.delete('Oauth-Wechat')) subspecs.add('Oauth-Wechat-PaySDK')
    if (subspecs.delete('Share-Wechat')) subspecs.add('Share-Wechat-PaySDK')
  }
  return { subspecs: [...subspecs], warnings }
}

// 三个构建流程的 target/scheme 名字写在 config/uapp_*.yml 里, Podfile 与构建命令都以它为准,
// 用户改过 target 名时不会出现 Podfile 指向不存在的 target / scheme 找不到
export function readIOSTargets(appDir) {
  const targets = { base: 'HBuilder', test: 'uapp-test', release: 'uapp-release' }
  const read = (file) => {
    const full = path.join(appDir, 'config', file)
    if (!fs.existsSync(full)) return ''
    const lines = fs.readFileSync(full, 'utf8').split('\n')
    const index = lines.findIndex((line) => /^targets:\s*$/.test(line))
    if (index === -1) return ''
    for (let i = index + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue
      const name = /^\s{2,}([^\s:#][^:]*):\s*$/.exec(lines[i])
      if (name) return name[1].trim()
      if (/^\S/.test(lines[i])) break
    }
    return ''
  }
  targets.base = read('uapp_dev.yml') || targets.base
  targets.test = read('uapp_test.yml') || targets.test
  targets.release = read('uapp_release.yml') || targets.release
  return targets
}

export function writePodfile({ appDir, subspecs, targets }) {
  const file = path.join(appDir, 'Podfile')
  const names = targets || readIOSTargets(appDir)
  const targetList = [names.base, names.test, names.release]
  // 工程名来自 project.yml, 用户改过名字时 Podfile 也要跟着走
  const projectYml = path.join(appDir, 'project.yml')
  const name = (fs.existsSync(projectYml) && /^name:\s*(\S+)/m.exec(fs.readFileSync(projectYml, 'utf8'))?.[1]) || 'uapp'
  // deploymentTarget 以工程配置为准: config/base.yml 是 xcodegen 的源头, project.yml 是生成物。
  // 下限由共用 SDK 的 uniapp.podspec (s.platform) 决定, 填得比它低 pod install 会直接报错
  const deploymentTarget = (() => {
    for (const file of ['config/base.yml', 'project.yml']) {
      const full = path.join(appDir, file)
      if (!fs.existsSync(full)) continue
      const matched = /^\s*deploymentTarget:\s*['"]?([\d.]+)['"]?/m.exec(fs.readFileSync(full, 'utf8'))
      if (matched) return matched[1]
    }
    return '15.0'
  })()
  // 只有广告类 subspec 依赖 podspec 之外的三方 SDK (Ads-CN-Beta/GDTMobSDK/KSAdSDK 等),
  // 其中字节系在 volcengine 源里, 所以选中 UniAd-* 时额外加一个 source;
  // Oauth/Payment/Share 全部是 vendored 静态库, 用 CDN 源即可, 避免克隆整个 Specs 仓库
  const sources = ["source 'https://cdn.cocoapods.org/'"]
  if (subspecs.some((name) => name.startsWith('UniAd-'))) sources.push("source 'https://github.com/volcengine/volcengine-specs.git'")
  // 选装模块 (Accelerometer/Proximity) 没在 manifest 里勾选时不写进 subspecs, 而是以注释形式写进
  // 生成的 Podfile: 用户在工程里取消注释 -> pod install 即可启用, 不必回头改 uapp 源码
  const optionalNames = Object.keys(OPTIONAL_SUBSPECS).filter((name) => !subspecs.includes(name))
  const subspecLines = subspecs.map((name) => `  '${name}',`)
  if (optionalNames.length) {
    subspecLines.push(
      '  # 以下模块云打包默认带, 但业务很少直接调用, 默认不装:',
      '  # 取消对应行的注释后执行 pod install 即可启用; 重跑 uapp 会重建本文件,',
      '  # 要长期启用请改 manifest 的 app-plus.modules (它优先于这里的注释)'
    )
    optionalNames.forEach((name) => {
      subspecLines.push(`  # ${OPTIONAL_SUBSPECS[name]}`)
      subspecLines.push(`  # '${name}',`)
    })
  }
  const content = `# 由 uapp prepare 生成: 内容随 manifest 的模块配置重建, 手改会在下次构建时被覆盖。
platform :ios, '${deploymentTarget}'
${sources.join('\n')}

project '${name}.xcodeproj'
use_frameworks! :linkage => :static

# SDKs/SDK 是 prepare 建的软链, realpath 解析到真实 SDK/SDK 后, 上一级就是含 uniapp.podspec 的根目录
sdk_path = File.expand_path('..', File.realpath(File.join(__dir__, 'SDKs', 'SDK')))
uniapp_subspecs = [
${subspecLines.join('\n')}
]
# UTS 插件仍由 prepare 写进 config/custom.yml (用户代码, 与 podspec 的 SDK 库不冲突)

${targetList.map((target) => `target '${target}' do
  pod 'uniapp', :path => sdk_path, :subspecs => uniapp_subspecs
end`).join('\n\n')}

post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      # DCloudUTSExtAPI.xcframework 只有 ios-x86_64-simulator 切片, 同时编 arm64 模拟器会选不到
      config.build_settings['ARCHS[sdk=iphonesimulator*]'] = 'x86_64'
      config.build_settings['VALID_ARCHS'] = 'x86_64 arm64'
    end
  end

  # feature.plist 覆盖必须发生在 [CP] Copy Pods Resources 之后, 否则 Pod 会把 SDK 里的原版拷回包里。
  # 这个 phase 由 prepare 写进 config/base.yml (uapp-feature-plist), 这里只把它挪到所有 phase 末尾。
  installer.aggregate_targets.map(&:user_project).compact.uniq.each do |project|
    moved = false
    project.targets.each do |target|
      phase = target.build_phases.find { |item| item.respond_to?(:name) && item.name == 'uapp-feature-plist' }
      next unless phase
      next if target.build_phases.last == phase
      target.build_phases.move(phase, target.build_phases.count - 1)
      moved = true
    end
    project.save if moved
  end
end
`
  fs.writeFileSync(file, content)
  return file
}

export function runPodInstall(appDir) {
  try {
    execSync('which pod', { stdio: 'ignore' })
  } catch (e) {
    throw new Error('未安装 CocoaPods, 请先执行 brew install cocoapods')
  }
  try {
    execSync('pod install', { cwd: appDir, stdio: 'inherit' })
  } catch (e) {
    throw new Error('pod install 失败: 请检查网络 (cdn.cocoapods.org)、Podfile 里的 subspec 是否存在于 uniapp.podspec')
  }
}

// Google 登录的四个 xcframework 必须由 SDK 发布方签名 (App Store ITMS-91065),
// DCloud 离线 SDK 里的这几份没签名。Pod 模式下它们直接从 SDK/Libs 进包,
// 所以打包前检查共用 SDK: 未签名就把工程里已签好的副本 (SDKs/GoogleOAuth) 同步过去。
// 用户的签名脚本 (ios/scripts/sign-google-xcframeworks.sh) 输出到 SDKs/GoogleOAuth, 这里只做"搬运"。
const SIGNED_GOOGLE_FRAMEWORKS = ['AppAuth', 'GTMAppAuth', 'GTMSessionFetcher', 'GoogleSignIn']

export function isXCFrameworkSigned(xcframeworkPath) {
  try {
    execFileSync('codesign', ['--verify', '--strict', xcframeworkPath], { stdio: 'ignore' })
    return true
  } catch (e) {
    return false
  }
}

export function ensureSignedGoogleFrameworks({ appDir, sdkLibsDir }) {
  const messages = []
  for (const name of SIGNED_GOOGLE_FRAMEWORKS) {
    const target = path.join(sdkLibsDir, `${name}.xcframework`)
    if (!fs.existsSync(target)) continue
    if (isXCFrameworkSigned(target)) continue
    const source = path.join(appDir, 'SDKs', 'GoogleOAuth', `${name}.xcframework`)
    if (!fs.existsSync(source) || !isXCFrameworkSigned(source)) {
      messages.push({
        level: 'warning',
        text: `SDK 里的 ${name}.xcframework 未签名, 工程里也没有可用的已签名副本 (SDKs/GoogleOAuth/${name}.xcframework), 上传 App Store 会报 ITMS-91065`
      })
      continue
    }
    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(source, target, { recursive: true })
    messages.push({ level: 'info', text: `✅ ${name}.xcframework 未签名, 已用工程内的已签名副本同步到共用 SDK` })
  }
  return messages
}
