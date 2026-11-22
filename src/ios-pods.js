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
  const subspecs = new Set(['Core'])
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
  // Oauth/Payment/UniAd 里有 podspec 依赖的三方 SDK (WechatOpenSDK 等), 需要 spec 源;
  // 用 CDN 源避免克隆整个 Specs 仓库, 广告类 subspec 另加 volcengine 源
  const sources = ["source 'https://cdn.cocoapods.org/'"]
  if (subspecs.some((name) => name.startsWith('UniAd-'))) sources.push("source 'https://github.com/volcengine/volcengine-specs.git'")
  const content = `# 由 uapp prepare 生成, 不要手改: 内容会随 manifest 的模块配置重建。
platform :ios, '15.0'
${sources.join('\n')}

project '${name}.xcodeproj'
use_frameworks! :linkage => :static

# SDKs/SDK 是 prepare 建的软链, realpath 解析到真实 SDK/SDK 后, 上一级就是含 uniapp.podspec 的根目录
sdk_path = File.expand_path('..', File.realpath(File.join(__dir__, 'SDKs', 'SDK')))
uniapp_subspecs = [${subspecs.map((name) => `'${name}'`).join(', ')}]
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
