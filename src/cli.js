/**
 * Author: Yin Qisen <yinqisen@gmail.com>
 * Github: https://github.com/uappx
 *
 * Copyright(c) 2022 - 2026, uapp.dev
 */

import _ from 'lodash'
import nopt from 'nopt'
import updateNotifier from 'update-notifier'
import fs from 'fs'
import ora from 'ora'
import yazl from 'yazl'
import os from 'os'
import path from 'path'
import { execSync, spawnSync, spawn } from 'child_process'
import tiged from '@uappx/tiged'
import chalk from 'chalk'
import sync from './sync.js'
import { readConfig, configCommand } from './config.js'
import { buildIOSModuleYml, patchFeaturePlist } from './iosModules.js'
import { updateAndroidModuleLibs, updateAndroidNativePluginLibs, updateAndroidUniplugins, updateAndroidPluginGradle, patchDcloudProperties, ANDROID_MODULE_PERMISSIONS, SDK_CONFIG_PERMISSIONS, ANDROID_MODULE_USES_FEATURES, ANDROID_SDK31_PERMISSIONS, MODULE_SDK_CONFIG, resolveAndroidTargetSdk } from './androidModules.js'
import { updateAndroidUtsModules, buildIOSUtsYml } from './utsModules.js'
import { isNativePluginPath, removeEmptyModuleDirectories } from './app-resources.js'
import { printIOSSigningInfo } from './ios-signing.js'
import { isPodSDKRoot, resolvePodSDKRoot, ensurePodSDKFiles, ensureSignedGoogleFrameworks, podSubspecs, writePodfile, runPodInstall, readIOSTargets, CORE_MOTION_SUBSPECS } from './ios-pods.js'
import stripJsonComments from './stripJsonComments.js'
import fsExtra from 'fs-extra'
const { emptyDirSync, removeSync, pathExistsSync } = fsExtra
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import readline from 'readline/promises'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = require('../package.json')

function normalizeVersionName(versionName) {
  if (versionName === undefined || versionName === null) return versionName
  return String(versionName).split('@')[0]
}

const knownOpts = {
  version: Boolean,
  help: Boolean,
  typescript: Boolean,
  alpha: Boolean,
  vue2: Boolean,
  copy: Boolean,
  open: Boolean,
  webapp: Boolean,
  prepare: Boolean,
  out: path,
  debug: String,
  release: String
}

const shortHands = {
  d: '--debug',
  r: '--release',
  o: '--out',
  v: '--version',
  h: '--help'
}

let $G = {
  args: {},
  appDir: process.cwd(),
  sdkHomeDir: path.join(os.homedir(), '.uappsdk'),
  localLinkManifest: path.join(process.cwd(), 'manifest.json'),
  manifest: {},
  webAppDir: '',
  projectType: 'unknown',
  config: {},
  // iOS/Android 模块依赖的结果先存起来，等 xcodebuild / gradle 的大量日志刷完再统一打印
  iosModuleNotice: null,
  androidModuleNotice: null
}

export default function (inputArgs) {
  checkForUpdates()
  // hbx/wx 后面是工具自己的参数：只解析前 3 个，避免 --help/--version 被 uapp 截获
  // 约束：hbx/wx 必须是第一个位置参数（与上游一致）；此路径下 args.argv.original 只保留到命令名
  const toolCommand = ['hbx', 'wx'].includes(inputArgs[2])
  let args = $G.args = nopt(knownOpts, shortHands, toolCommand ? inputArgs.slice(0, 3) : inputArgs)

  if (args.version) {
    console.log('uapp 当前版本: ' + pkg.version)
    return
  }

  if (args.copy === undefined) {
    args.copy = true
  }

  if (args.webapp === undefined) {
    args.webapp = false
  }

  if (args.prepare === undefined) {
    args.prepare = true
  }

  // command: uapp help
  const cmd = args.argv.remain[0] || 'help'
  if (!cmd || cmd === 'help' || args.help) {
    printHelp()
    return
  }

  if (cmd === 'privacy') {
    ;(async () => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      try {
        console.log(chalk.yellow('提示: uapp 不承诺协议内容的专业合法性，如您对此有要求，请咨询专业律师起草，并自行替换'))
        const companyFullName = await rl.question('输入公司全名: ')
        const companyShortName = await rl.question('输入公司简称: ')
        const appName = await rl.question('输入APP名字: ')
        const contactUs = await rl.question('输入联系方式: ')

        let regTplFile = path.resolve('./reg.tpl.md')
        let privacyTplFile = path.resolve('./privacy.tpl.md')
        if (!fs.existsSync(regTplFile)) {
          regTplFile = path.resolve(__dirname, '../uappsdk/templates/privacy/reg.tpl.md')
        }

        if (!fs.existsSync(privacyTplFile)) {
          privacyTplFile = path.resolve(__dirname, '../uappsdk/templates/privacy/privacy.tpl.md')
        }

        ;[regTplFile, privacyTplFile].map(file => {
          let content = fs.readFileSync(file, 'utf8')
          content = content.replace(/\$COMPANY_FULL\$/g, companyFullName)
          content = content.replace(/\$COMPANY_SHORT\$/g, companyShortName)
          content = content.replace(/\$APPNAME\$/g, appName)
          content = content.replace(/\$CONTACT_US\$/g, contactUs)

          let newFile = file.replace('.tpl.md', '.md').split('/').pop()
          newFile = path.resolve('./' + newFile)
          fs.writeFileSync(newFile, content)
          console.log(chalk.green(newFile))
        })
      } catch (err) {
        console.log(`Error: `, err)
      } finally {
        rl.close()
      }
    })()
    return
  }

  let configFile = path.join($G.sdkHomeDir, 'config.json')
  if (cmd === 'config') {
    return configCommand(args.argv.original.slice(args.argv.original.indexOf(cmd) + 1), configFile)
  }
  $G.config = readConfig(configFile)

  if (!$G.config['hbx.dir'] && process.platform === 'darwin') {
    $G.config['hbx.dir'] = '/Applications/HBuilderX.app'
  }

  if (!$G.config['wx.dir']) {
    let settingFile = ''
    let defaultPath = ''

    if (process.platform === 'darwin') {
      settingFile = path.join(os.homedir(), 'Library/Application Support/HBuilder X/user/settings.json')
      defaultPath = '/Applications/wechatwebdevtools.app'
    } else if (process.platform === 'win32') {
      settingFile = path.join(os.homedir(), 'AppData/Roaming/HBuilder X/user/settings.json')
      defaultPath = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具'
    }

    try {
      $G.config['wx.dir'] = JSON.parse(fs.readFileSync(settingFile, 'utf8'))['weApp.devTools.path'] || defaultPath
    } catch {
      $G.config['wx.dir'] = defaultPath
    }
  }

  if (cmd === 'hbx') {
    return runHBuilderXCli(inputArgs.slice(3))
  }

  if (cmd === 'wx') {
    return runWeixinCli(inputArgs.slice(3))
  }

  // 如果当面目录不存在 manifest.json，尝试使用 ../src/manifest.json
  if (!fs.existsSync($G.localLinkManifest)) {
    let tryManifestFile = path.resolve(path.join($G.appDir, '../src/manifest.json'))
    if (fs.existsSync(tryManifestFile)) {
      $G.localLinkManifest = tryManifestFile
    }
  }

  if (fs.existsSync(path.join($G.appDir, 'Main/AppDelegate.m'))) {
    $G.projectType = 'ios'
  } else if (fs.existsSync(path.join($G.appDir, '/app/build.gradle'))) {
    $G.projectType = 'android'
  } else if (fs.existsSync(path.join($G.appDir, 'pages.json')) && pathExistsSync(path.join($G.appDir, 'pages'))) {
    $G.projectType = 'webapp'
  } else if (
    fs.existsSync(path.join($G.appDir, '/src/pages.json')) &&
    pathExistsSync(path.join($G.appDir, '/src/pages'))
  ) {
    $G.projectType = 'webapp'
    $G.localLinkManifest = path.join(process.cwd(), 'src/manifest.json')
  }

  // command: uapp new
  if (cmd === 'new') {
    let projectName = args.argv.remain[1]
    if (!projectName) {
      return console.log('缺少参数名，例如: uapp new project1')
    }

    if (args.vue2) {
      // vue2 必须使用小写
      let baseCommand = args.alpha
        ? 'vue create -p dcloudio/uni-preset-vue#alpha '
        : 'vue create -p dcloudio/uni-preset-vue '
      try {
        execSync(baseCommand + projectName.toLowerCase(), { stdio: 'inherit' })
      } catch (error) {
        console.log('请先安装 vue 环境:')
        console.log('npm i -g @vue/cli')
      }
    } else {
      clone(`https://gitee.com/uappkit/platform.git/src/#main`, projectName)
    }
    return
  }

  // command: uapp sdk init
  if (cmd === 'sdk' && args.argv.remain[1] === 'init') {
    sync(path.resolve(__dirname, '../uappsdk'), $G.sdkHomeDir, { delete: false })
    console.log(chalk.green('--- uappsdk 已安装 ---'))
    return
  }

  // command: uapp add ${platform}
  // support platforms: android, ios
  if (cmd === 'add') {
    let platform = args.argv.remain[1]
    let supportPlatform = ['android', 'ios']
    if (!supportPlatform.includes(platform)) {
      console.log(`不支持平台 ${platform}, 当前支持的平台有: ${supportPlatform.join(', ')}`)
      return
    }

    // 优先使用本地模板 (uapp sdk init 会把内置模板同步到 ~/.uappsdk/templates/)
    const localTemplate = path.join($G.sdkHomeDir, 'templates', platform)
    if (platform === 'ios' && fs.existsSync(localTemplate)) {
      const dest = path.join(process.cwd(), platform)
      if (fs.existsSync(dest)) {
        console.log(chalk.red('目录已存在: ' + dest))
        return
      }
      sync(localTemplate, dest, { delete: false })

      // manifest.json 必须是软链指向根 manifest.json (模板复制不会带软链)
      const manifestLink = path.join(dest, 'manifest.json')
      if (!fs.existsSync(manifestLink) || !fs.lstatSync(manifestLink).isSymbolicLink()) {
        fs.rmSync(manifestLink, { force: true })
        fs.symlinkSync('../manifest.json', manifestLink)
      }

      // SDK 软链 (指向本机 ~/.uappsdk/ios/SDK)
      const sdkLinkDir = path.join(dest, 'SDKs', 'SDK')
      if (!fs.existsSync(sdkLinkDir) && fs.existsSync(path.join($G.sdkHomeDir, 'ios/SDK'))) {
        fs.symlinkSync(path.join($G.sdkHomeDir, 'ios/SDK'), sdkLinkDir, 'dir')
      }

      console.log(chalk.green('--- iOS 工程已创建 (本地模板) ---'))
      console.log('下一步:')
      console.log('1. 根 manifest.json 的 uapp.ios 节点填 base / test / sim / release 四套 package + appkey')
      console.log('2. 按签名信息修改 ios/config/*.yml 的 DEVELOPMENT_TEAM / PROVISIONING_PROFILE_SPECIFIER')
      console.log('   export_*.plist 的 teamID / 签名证书 / profile 名由 prepare 从对应 yml 同步，只需按需改 method')
      console.log('   测试包默认共用 export_dev.plist，要跟正式包同一种导出方式就设 uapp.ios.test.export=release，')
      console.log('   要和正式包的 method 不同 (如测试包 ad-hoc) 就设 own 并改 config/export_test.plist 的 method')
      console.log('3. cd ios && xcodegen generate && pod install (uapp run build 会自动执行)')
      console.log('4. 打包: uapp run build:app-plus base|test|sim|release')
      return
    }

    return clone(`https://gitee.com/uappkit/platform.git/${platform}#main`, platform)
  }

  /*
  |--------------------------------------------------------------------------
  | 命令分水岭
  | * 上面命令不需要限制项目目录下
  | * 下面命令需要限制在项目下运行
  |--------------------------------------------------------------------------
  */

  if ($G.projectType === 'unknown') {
    console.log('无法确定项目类型，请在项目的根目录下运行命令')
    console.log('目前支持的项目类型有: webapp, android, ios')
    return
  }

  if ($G.projectType === 'webapp' && cmd !== 'run') {
    return console.log('webapp 不支持命令 uapp ' + cmd)
  }

  // command: uapp keygen
  if (cmd === 'keygen') {
    if ($G.projectType === 'android') {
      console.log('注意: ')
      console.log('build.gradle 中密码默认为 123456, 如有修改为其他密码，请对应修改 build.gradle 中的配置')
    }
    console.log('需要输入两次6位密码, 例如输入密码: 123456\n')

    let keyFile = path.join($G.appDir, 'app/app.keystore')
    fs.mkdirSync(path.dirname(keyFile), { recursive: true })

    try {
      let keyCommand =
        'keytool -genkey -alias key0 -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=uapp" -keystore ' + keyFile
      execSync(keyCommand, { stdio: 'inherit' })
      console.log('\n证书生成位置: ' + keyFile)
    } catch (error) {
      console.log('\n错误解决方法, 改名已存在的文件: ' + keyFile)
    }

    return
  }

  // command:
  // uapp manifest path/to/manifest.json
  if (cmd === 'manifest') {
    let manifestFile = args.argv.remain[1]
    if (manifestFile && !fs.existsSync(manifestFile)) {
      console.log('找不到: ' + manifestFile)
      return
    }

    if (manifestFile) {
      $G.localLinkManifest = path.join($G.appDir, '/manifest.json')
      try {
        let fstats = fs.lstatSync($G.localLinkManifest)
        if (fstats.isSymbolicLink()) {
          fs.unlinkSync($G.localLinkManifest)
        } else {
          let backupName = 'manifest-' + new Date().getTime() + '.json'
          console.log('注意：将已存在 manifest.json 文件更名为: ' + backupName)
          fs.renameSync($G.localLinkManifest, $G.localLinkManifest.replace('manifest.json', backupName))
        }
      } catch (error) {}

      fs.symlinkSync(manifestFile, $G.localLinkManifest)
    }

    if (!fs.existsSync($G.localLinkManifest)) {
      console.log('文件不存在: ' + $G.localLinkManifest)
      console.log('配置命令为: uapp manifest path/to/manifest.json')
      return
    }

    loadManifest()
    printManifestInfo()
    return
  }

  // 加载 manifest.json 数据
  loadManifest()
  $G.webAppDir = path.dirname(fs.realpathSync($G.localLinkManifest))

  // command: uapp info, uapp info jwt, uapp info key
  if (cmd === 'info') {
    const infoArg = args.argv.remain[1]
    if (infoArg && !['jwt', 'key'].includes(infoArg)) {
      process.exitCode = 1
      return console.log(chalk.yellow('不支持的 info 参数。用法: uapp info、uapp info jwt、uapp info key'))
    }

    printManifestInfo()

    // 仅 iOS 且未指定子命令时展示发行证书信息
    if ($G.projectType === 'ios' && !infoArg) {
      printIOSSigningInfo($G.appDir)
    }

    if (($G.projectType === 'ios' && !infoArg) || infoArg === 'jwt') {
      printJWTToken().then()
      return
    }

    if ($G.projectType === 'android') {
      let keyFile = path.join($G.appDir, 'app/app.keystore')
      if (!fs.existsSync(keyFile)) {
        console.log('找不到 keystore 签名文件: ' + keyFile)
        return
      }

      let gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
      if (!fs.existsSync(path.resolve(gradle))) {
        console.log('找不到 gradle 命令: ' + gradle)
        return
      }

      printAndroidKeyInfo(gradle)
      return
    }
  }

  // command: uapp prepare
  if (cmd === 'prepare') {
    return (async () => {
      if (!args.argv.remain[1] || !args.argv.remain[1].startsWith('build:app')) {
        process.exitCode = 1
        return console.log(chalk.yellow(`命令无效，${$G.projectType} 工程仅支持 uapp prepare build:app*, 支持自定义扩展且名字必须app开头`))
      }

      if (args.webapp) {
        await buildWebApp(args.argv.remain[1])
      }

      prepareCommand()
    })()
  }

  // command: uapp run custom
  if (cmd === 'run' && args.argv.remain[1] === 'custom') {
    let command = $G.manifest.uapp[`${$G.projectType}.custom.command`] || $G.manifest.uapp['custom.command']
    if (!command) {
      console.log('自定义命令为空，请参照文档中的 custom.command 配置')
    } else {
      command = command.replace(/\$\{SRC\}/g, $G.webAppDir)
      execSync(command, { stdio: 'inherit' })
    }
    return
  }

  // commands:
  // 先判断 projectType, webapp, android, ios
  // webapp 时支持: uapp run dev:* , uapp run build:* , uapp run test:*
  // app 时支持: uapp run build:app* , uapp run test:app-*
  if (cmd === 'run') {
    console.log('当前工程类型为 ' + chalk.yellow($G.projectType + ', vue' + $G.manifest.vueVersion))

    if ($G.projectType !== 'webapp' && $G.args.release?.split('.').pop() === 'wgt') {
      process.exitCode = 1
      return console.log('命令无效，仅支持在 webapp 工程下打包为 wgt格式')
    }

    if (args.argv.remain[1]?.startsWith('test:')) {
      return runUniAppTest(args.argv.remain[1])
    }

    if ($G.projectType === 'webapp') {
      if ($G.args.release && $G.args.release.split('.').pop() !== 'wgt') {
        console.log(chalk.yellow(`webapp 工程下忽略 --release 参数 (${$G.args.release})`))
      }

      let [a, b] = (args.argv.remain[1] || '').split(':')
      if (!['build', 'dev'].includes(a) || !b) {
        process.exitCode = 1
        return console.log('命令无效，webapp 仅支持 uapp run build:* / dev:*, 支持自定义扩展')
      }

      return buildWebApp(args.argv.remain[1])
    }

    if (!args.argv.remain[1] || !args.argv.remain[1].startsWith('build:app')) {
      process.exitCode = 1
      return console.log(chalk.yellow(`命令无效，${$G.projectType} 工程仅支持 uapp run build:app*, 支持自定义扩展且名字必须app开头`))
    }

    return (async () => {
      if (args.prepare) {
        if (args.webapp) {
          await buildWebApp(args.argv.remain[1])
        }

        prepareCommand()
      }

      const buildType = args.argv.remain[2] || 'dev'

      if ($G.projectType === 'android') {
        const assembleTypeMap = {
          apk: 'assembleOriginRelease',
          'apk:huawei': 'assembleHuaweiRelease',
          'apk:honor': 'assembleHonorRelease',
          'apk:xiaomi': 'assembleXiaomiRelease',
          'apk:vivo': 'assembleVivoRelease',
          'apk:oppo': 'assembleOppoRelease',
          'apk:meizu': 'assembleMeizuRelease',
          dev: 'assembleOriginDebug',
          'dev:huawei': 'assembleHuaweiDebug',
          'dev:honor': 'assembleHonorDebug',
          'dev:xiaomi': 'assembleXiaomiDebug',
          'dev:vivo': 'assembleVivoDebug',
          'dev:oppo': 'assembleOppoDebug',
          'dev:meizu': 'assembleMeizuDebug',
          aab: 'bundleRelease'
        }
        const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
        if (buildType === 'apk:all') {
          const channels = ['origin', 'huawei', 'honor', 'xiaomi', 'vivo', 'oppo', 'meizu']
          for (const ch of channels) {
            const papkFileName = `app-${ch}-${$G.manifest.uapp.versionName}-release.apk`
            const assembleType = assembleTypeMap[`apk:${ch}`] || assembleTypeMap.apk
            execSync(`${gradle} ${assembleType} -PapkFileName=${papkFileName} -s`, {
              stdio: 'inherit'
            })
          }
          console.log('\n编译成功，安装包位置: ')
          console.log(path.join($G.appDir, 'app/build/outputs/apk/'))
        } else {
          if (!assembleTypeMap[buildType]) {
            process.exitCode = 1
            console.log(chalk.red(`无效的构建类型: ${buildType}`))
            console.log('示例: dev, dev:huawei, apk, apk:huawei, apk:all, aab 等')
            return
          }
          const isDev = buildType.includes('dev')
          const channel = buildType.split(':')[1] || 'origin'
          const outFileMap = {
            apk: `apk/${channel}/release/`,
            dev: `apk/${channel}/debug/`
          }
          const suffix = buildType === 'aab' ? 'aab' : 'apk'
          const papkFileName = `app-${channel}-${$G.manifest.uapp.versionName}-${
            isDev ? 'debug' : 'release'
          }.${suffix}`
          execSync(`${gradle} ${assembleTypeMap[buildType]} -s`, {
            stdio: 'inherit'
          })

          // aab/apk 的目录与文件名都由 AGP 按 project/flavor/buildType 生成,
          // 各 AGP 版本命名不完全一致, 故按实际产物查找后统一重命名
          let buildOutFile = null
          if (buildType === 'aab') {
            const aabFile = findBundleArtifact(channel)
            // 命中则统一命名, 找不到时回落到目录本身, 由 checkBuildArtifact 报错并指出查找位置
            buildOutFile = aabFile
              ? renameBundleArtifact(aabFile, channel)
              : path.join($G.appDir, 'app/build/outputs/bundle', `${channel}Release`)
          } else {
            const outFileMapValue = outFileMap[buildType.split(':')[0]]
            const apkFile = findApkArtifact(channel, isDev)
            buildOutFile = apkFile
              ? renameApkArtifact(apkFile, channel, isDev)
              : path.join($G.appDir, 'app/build/outputs/', `${outFileMapValue}${papkFileName}`)
          }
          checkBuildArtifact(buildOutFile)

          if (isDev && args.copy) {
            sync(buildOutFile, path.join($G.webAppDir, 'unpackage/debug/android_debug.apk'), {
              delete: true
            })
          }

          console.log('\n编译成功，安装包位置: ')
          console.log(buildOutFile)
          if (args.argv.remain[3] === 'upload') {
            console.log('开始上传到蒲公英平台...')
            uploadFile(buildOutFile)
          }
        }
        printModuleNotice()
        return
      }

      if ($G.projectType === 'ios') {
        // 构建命令不一定带 --prepare: 这里重新判定 Pod 模式, 保证 project.yml/Podfile 与实际构建方式一致
        setupIOSPodMode()
        // 版本号写进 config/base.yml 后 xcodegen 才会读进去; 直接用 build 命令时 prepare 没跑过
        updateIOSVersions()
        try {
          execSync('xcodegen', { stdio: 'inherit' })
        } catch (e) {
          console.log('请先安装 xcodegen, 可通过 brew install xcodegen 安装, 参考 iOS 配置文档: ')
          console.log('👉 https://gitee.com/uappkit/platform/blob/main/ios/README.md')
          return
        }
        const name = fs.readFileSync(path.join($G.appDir, '/project.yml'), 'utf8').match(/^name:\s*(\S+)/m)[1]
        const targets = readIOSTargets($G.appDir)
        // xcodegen 重新生成工程后 Pod 接线会被覆盖, 必须重新 pod install 并改用 workspace 构建
        // Pod 模式直接引用 SDK/Libs 里的 Google 框架: 未签名时用工程内的已签名副本补齐 (ITMS-91065)
        try {
          const sdkLibs = path.join(fs.realpathSync(path.join($G.appDir, 'SDKs/SDK')), 'Libs')
          for (const item of ensureSignedGoogleFrameworks({ appDir: $G.appDir, sdkLibsDir: sdkLibs })) {
            console.log(item.level === 'info' ? chalk.green(item.text) : chalk.yellow(item.text))
          }
        } catch (e) {
          console.log(chalk.yellow(`检查 SDK 内 Google 框架签名失败: ${e.message}`))
        }
        try {
          runPodInstall($G.appDir)
        } catch (e) {
          console.log(chalk.red(e.message))
          return
        }
        const projectFlag = `-workspace ${name}.xcworkspace`
        if (buildType === 'test') {
          // gererate uapp_test.xcarchive
          execSync(
            `xcodebuild ${projectFlag} -destination "generic/platform=iOS" -scheme "${targets.test}" -archivePath out/${name}_test.xcarchive archive`,
            { stdio: 'inherit' }
          )

          // generate ipa
          execSync(
            `xcodebuild -exportArchive -archivePath out/${name}_test.xcarchive -exportPath out -exportOptionsPlist config/${resolveIOSExportPlist('test')}`,
            { stdio: 'inherit' }
          )

          // 重命名 IPA 文件
          const originalFilePath = path.join($G.appDir, `out/${targets.test}.ipa`)
          const newFilePath = path.join(
            $G.appDir,
            `out/app-${$G.manifest.uapp.versionName}-test.ipa`
          )
          execSync(`mv ${originalFilePath} ${newFilePath}`, { stdio: 'inherit' })
          checkBuildArtifact(newFilePath)

          if (args.argv.remain[3] === 'upload') {
            console.log('开始上传到蒲公英平台...')
            uploadFile(newFilePath)
          }
        } else if (buildType === 'base') {
          // gererate uapp_debug.xcarchive
          execSync(
            `xcodebuild ${projectFlag} -destination "generic/platform=iOS" -scheme "${targets.base}" -archivePath out/${name}_debug.xcarchive archive`,
            { stdio: 'inherit' }
          )

          // generate ipa
          execSync(
            `xcodebuild -exportArchive -archivePath out/${name}_debug.xcarchive -exportPath out -exportOptionsPlist config/export_dev.plist`,
            { stdio: 'inherit' }
          )

          const ipaFile = path.join($G.appDir, `out/${targets.base}.ipa`)
          checkBuildArtifact(ipaFile)
          if (args.copy) {
            sync(
              ipaFile,
              path.join($G.webAppDir, 'unpackage/debug/ios_debug.ipa'),
              { delete: true }
            )
          }
        } else if (buildType === 'sim') {
          execSync(
            `arch -x86_64 xcodebuild \
            ${projectFlag} \
            -destination "generic/platform=iOS Simulator" \
            -scheme "${targets.base}"\
            -configuration Debug \
            EXCLUDED_ARCHS="arm64" \
            BUILD_LIBRARIES_FOR_DISTRIBUTION=YES \
            build \
            -derivedDataPath out/${name}_debug.xcarchive`,
            { stdio: 'inherit' }
          )
          if (args.copy) {
            sync(
              path.join($G.appDir, `out/${name}_debug.xcarchive/Build/Products/Debug-iphonesimulator/HBuilder.app`),
              path.join($G.webAppDir, 'unpackage/debug/Pandora_simulator_debug.app'),
              { delete: true }
            )
          }
        } else if (buildType === 'release') {
          const exportOptionsPlist = path.join($G.appDir, 'config/export_release.plist')
          if (!fs.existsSync(exportOptionsPlist)) {
            console.log(
              chalk.red('缺少 config/export_release.plist，请按项目签名信息创建 (method: app-store-connect 或 ad-hoc)')
            )
            console.log('👉 https://gitee.com/uappkit/platform/blob/main/ios/README.md')
            return
          }

          // gererate uapp_release.xcarchive
          execSync(
            `xcodebuild ${projectFlag} -destination "generic/platform=iOS" -scheme "${targets.release}" -archivePath out/${name}_release.xcarchive archive`,
            { stdio: 'inherit' }
          )

          // generate ipa
          execSync(
            `xcodebuild -exportArchive -archivePath out/${name}_release.xcarchive -exportPath out -exportOptionsPlist config/export_release.plist`,
            { stdio: 'inherit' }
          )

          // 重命名 IPA 文件
          const originalFilePath = path.join($G.appDir, `out/${targets.release}.ipa`)
          const newFilePath = path.join(
            $G.appDir,
            `out/app-${$G.manifest.uapp.versionName}-release.ipa`
          )
          execSync(`mv ${originalFilePath} ${newFilePath}`, { stdio: 'inherit' })
          checkBuildArtifact(newFilePath)
        } else {
          process.exitCode = 1
          console.log(chalk.red(`无效的 iOS 构建类型: ${buildType}`))
          console.log(`示例: ${IOS_BUILD_TYPES.join(', ')}`)
          return
        }
        console.log(
          chalk.yellow('iOS: base=真机自定义基座, test=测试包, sim=模拟器包, release=正式包 (需 config/export_release.plist)')
        )
        printModuleNotice()
      }
    })()
  }

  printHelp()
}

function uploadFile(APP_PATH) {
  console.log(chalk.yellow('uploadFile 功能暂未启用，请等待后续版本'))
  console.log('待上传文件: ' + APP_PATH)
}

function checkForUpdates() {
  try {
    // Checks for available update and returns an instance
    const notifier = updateNotifier({ pkg: pkg })

    if (notifier.update && notifier.update.latest !== pkg.version) {
      // Notify using the built-in convenience method
      notifier.notify()
    }
  } catch (e) {
    // https://issues.apache.org/jira/browse/CB-10062
    if (e && e.message && /EACCES/.test(e.message)) {
      console.log('Update notifier was not able to access the config file.')
    } else {
      throw e
    }
  }
}

function checkManifest() {
  if (!fs.existsSync($G.localLinkManifest)) {
    console.log('请先执行 `uapp manifest path/to/manifest.json` 指定 manifest.json 文件')
    process.exit(1)
  }
}

function loadManifest() {
  checkManifest()
  console.log('当前使用 manifest: ' + $G.localLinkManifest)

  if (fs.existsSync($G.localLinkManifest)) {
    let content = fs.readFileSync($G.localLinkManifest, 'utf8')
    $G.manifest = JSON.parse(stripJsonComments(content))
  }

  if (!$G.manifest.vueVersion) {
    $G.manifest.vueVersion = 2
  }

  const runArg = $G.args.argv.remain[1] || ''
  if (
    !['android', 'ios'].includes($G.projectType) &&
    (
      $G.args.argv.remain[0] === 'run' &&
      (runArg.startsWith('test:') || !runArg.includes(':app'))
    )
  ) {
    return
  }

  if (!$G.manifest.uapp) {
    console.log(chalk.yellow('manifest.json 中缺少 uapp 节点，请复制并添加如下内容'))
    console.log(`
"uapp": {
  "package": "com.code0xff.uapp",
  "android.appid": "android 的 appid (选填, 未填回退根节点 appid)",
  "android.appkey": "申请并替换为 android dcloudkey",
  "ios": {
    "appid": "ios 的 appid (选填, 未填回退根节点 appid)",
    "base": { "package": "com.code0xff.uapp", "appkey": "base 的 dcloudkey (必填)" },
    "test": { "package": "com.code0xff.uapp.test", "appkey": "test 的 dcloudkey (可选, 未填回退 base)" },
    "release": { "package": "com.code0xff.uapp", "appkey": "release 的 dcloudkey (必填)" }
  }
},
    `)
    process.exit(1)
  }

  if ($G.manifest.uapp[`${$G.projectType}.name`] || $G.manifest.uapp.name) {
    console.log(chalk.yellow('已废弃 uapp.name / uapp.<platform>.name，应用名统一取根节点 manifest.json 的 name'))
  }
  $G.manifest.uapp.name = $G.manifest.name
  $G.manifest.uapp.versionName = $G.manifest.uapp[`${$G.projectType}.versionName`] || $G.manifest.uapp.versionName || $G.manifest.versionName
  $G.manifest.uapp.versionCode = $G.manifest.uapp[`${$G.projectType}.versionCode`] ?? $G.manifest.uapp.versionCode ?? $G.manifest.versionCode
  if ($G.projectType === 'ios') {
    // iOS 的 package/appkey 按构建类型取自 uapp.ios.{base|test|sim|release}, 见 updateIOSMetaData
    $G.manifest.uapp.package = ''
    $G.manifest.uapp.appkey = ''
    if ($G.manifest.uapp['ios.package'] || $G.manifest.uapp['ios.appkey']) {
      console.log(chalk.yellow('已废弃 uapp["ios.package"] / uapp["ios.appkey"]，请迁移到 uapp.ios.{base|test|sim|release}'))
    }
  } else {
    $G.manifest.uapp.package = $G.manifest.uapp[`${$G.projectType}.package`] || $G.manifest.uapp.package || ''
    $G.manifest.uapp.appkey = $G.manifest.uapp[`${$G.projectType}.appkey`] || ''
  }

  // appid 支持分平台配置: uapp.android.appid / uapp.ios.appid。
  // 平台专属值没填时才逐级回退: uapp.appid -> 根节点 appid。
  const platformAppid = $G.projectType === 'ios'
    ? $G.manifest.uapp.ios?.appid
    : $G.manifest.uapp[`${$G.projectType}.appid`]
  $G.manifest.uapp.appid = String(platformAppid || $G.manifest.uapp.appid || $G.manifest.appid || '').trim()
  if (!$G.manifest.uapp.appid) {
    console.log(chalk.yellow('manifest.json 中缺少 appid，请打开 HBuilderX 获取'))
    console.log(chalk.yellow('也可以按平台配置 uapp.android.appid / uapp.ios.appid'))
  }
}

function checkBuildArtifact(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error('未找到构建产物文件: ' + file)
  }
}

// aab 由 bundleRelease 产出到 app/build/outputs/bundle/<flavor><BuildType>/ 下,
// 文件名由 AGP 用 project 名和 variant 名拼出, 不受 -PapkFileName 控制
function findBundleArtifact(channel) {
  const bundleDir = path.join($G.appDir, 'app/build/outputs/bundle', `${channel}Release`)
  if (!fs.existsSync(bundleDir)) {
    return null
  }
  const aabFiles = fs
    .readdirSync(bundleDir)
    .filter((name) => name.endsWith('.aab'))
    .map((name) => {
      const file = path.join(bundleDir, name)
      return { file, mtime: fs.statSync(file).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
  return aabFiles.length ? aabFiles[0].file : null
}

// 统一 aab 命名为 app-<channel>-<version>-release.aab, 与 apk 保持一致
function renameBundleArtifact(file, channel) {
  const target = path.join(
    path.dirname(file),
    `app-${channel}-${$G.manifest.uapp.versionName}-release.aab`
  )
  if (target === file) {
    return target
  }
  fs.rmSync(target, { force: true })
  fs.renameSync(file, target)
  return target
}

// apk 由 AGP 按 project/flavor/buildType 命名(如 app-origin-release.apk),
// 各 AGP 版本命名不完全一致, 按目录扫描取实际产物
function findApkArtifact(channel, isDev) {
  const apkDir = path.join($G.appDir, 'app/build/outputs/apk', channel, isDev ? 'debug' : 'release')
  if (!fs.existsSync(apkDir)) {
    return null
  }
  const apkFiles = fs
    .readdirSync(apkDir)
    .filter((name) => name.endsWith('.apk'))
    .sort()
  if (!apkFiles.length) {
    return null
  }
  return path.join(apkDir, apkFiles[apkFiles.length - 1])
}

// 统一 apk 命名为 app-<channel>-<version>-<debug|release>.apk
function renameApkArtifact(file, channel, isDev) {
  const target = path.join(
    path.dirname(file),
    `app-${channel}-${$G.manifest.uapp.versionName}-${isDev ? 'debug' : 'release'}.apk`
  )
  if (target === file) {
    return target
  }
  fs.rmSync(target, { force: true })
  fs.renameSync(file, target)
  return target
}

function prepareCommand() {
  let compiledDir = getBuildOut()
  const buildType = $G.args.argv.remain[2] || ''
  if (!String($G.manifest.name || '').trim()) {
    console.log(chalk.red('manifest.json 根节点缺少 name，无法确定 App 名称'))
    console.log('请在 manifest.json 根节点配置 name（uapp.name / uapp.<platform>.name 已废弃）')
    process.exit(1)
  }
  if (!buildType.includes('dev') && !['base', 'sim'].includes(buildType) && (!pathExistsSync(compiledDir) || !fs.statSync(compiledDir).isDirectory())) {
    console.log(chalk.red('找不到本地App打包资源'))
    console.log('请使用 HBuilderX => 发行(菜单) => 原生App本地打包 => 生成本地打包App资源')
    process.exit(1)
  }

  let resDir = path.join($G.webAppDir, 'unpackage/res/icons')
  // 如果没生成过图标目录, 跳过
  if (pathExistsSync(resDir)) {
    if ($G.projectType === 'android') {
      updateAndroidIcons(resDir)
    } else if ($G.projectType === 'ios') {
      updateIOSIcons(resDir)
    }
  } else {
    console.log(chalk.yellow('未发现图标资源，跳过App图标更新'))
    console.log('更新图标请使用 HBuilderX => manifest.json 配置 => App图标配置 => 自动生成所有图标\n')
  }

  if ($G.projectType === 'android') {
    updateAndroidMetaData()
  } else if ($G.projectType === 'ios') {
    updateIOSMetaData()
  }

  let embedAppsDir = path.join(
    $G.appDir,
    $G.projectType === 'ios' ? 'Main/Pandora/apps' : 'app/src/main/assets/apps'
  )
  if (buildType.includes('dev') || ['base', 'sim'].includes(buildType)) {
    removeSync(path.join(embedAppsDir, $G.manifest.uapp.appid))
  } else {
    const embedWwwDir = path.join(embedAppsDir, $G.manifest.uapp.appid, 'www')
    emptyDirSync(embedAppsDir)
    // 原生插件源码（utssdk / app-android 等）由 updateAndroidUtsModules / buildIOSUtsYml 单独集成，不复制进 www
    fsExtra.copySync(compiledDir, embedWwwDir, {
      filter: source => !isNativePluginPath(path.relative(compiledDir, source))
    })
    removeEmptyModuleDirectories(path.join(embedWwwDir, 'uni_modules'))
    console.log(chalk.green('APP打包所需资源已更新'))
  }

  // run build:app* 的结果由构建分支末尾统一输出，避免重复；prepare 单独执行时在这里输出
  const isRunBuild =
    $G.args.argv.remain[0] === 'run' && String($G.args.argv.remain[1] || '').startsWith('build:app')
  if (!isRunBuild) printModuleNotice()
}

/*
 * android platform
 */

function updateAndroidMetaData() {
  let wxEntryActivityFile = 'WXEntryActivity.java'
  let wXPayEntryActivityFile = 'WXPayEntryActivity.java'
  let versionName = normalizeVersionName($G.manifest.uapp.versionName)

  let baseGradleFile = path.join($G.appDir, 'app/build.gradle')
  let content = fs.readFileSync(baseGradleFile, 'utf8')

  content = content.replace(/(namespace\s*(?:=\s*)?")(.*)(")/, '$1' + $G.manifest.uapp.package + '$3')
  content = content.replace(/(applicationId\s*(?:=\s*)?")(.*)(")/, '$1' + $G.manifest.uapp.package + '$3')
  content = content.replace(/(app_name'\s*,\s*")(.*)(")/, '$1' + $G.manifest.uapp.name + '$3')
  content = content.replace(/(versionCode\s*(?:=\s*)?)(\d+)/, '$1' + $G.manifest.uapp.versionCode)
  content = content.replace(/(versionName\s*(?:=\s*)?")(.*)(")/, '$1' + versionName + '$3')
  content = content.replace(/("DCLOUD_APPKEY"\s*:\s*")(.*)(",)/, '$1' + $G.manifest.uapp.appkey + '$3')
  content = updateAndroidSdkVersions(content)

  const weixin = $G.manifest['app-plus']?.distribute?.sdkConfigs?.oauth?.weixin
  const isWxAppid = !!weixin?.appid
  if (isWxAppid) {
    content = content.replace(
      /("WX_APPID"\s+:\s+")(.*)(",)/,
      '$1' + weixin.appid + '$3'
    )
  }

  const isWxAppsecret = !!weixin?.appsecret
  if (isWxAppsecret) {
    content = content.replace(
      /("WX_SECRET"\s+:\s+")(.*)(",)/,
      '$1' + weixin.appsecret + '$3'
    )
  }
  fs.writeFileSync(baseGradleFile, content)

  // DONT change content here
  if (isWxAppid && isWxAppsecret) {
    let contentOfEntryFiles = {
      [wxEntryActivityFile]: `package ${$G.manifest.uapp.package}.wxapi;
import io.dcloud.feature.oauth.weixin.AbsWXCallbackActivity;
public class WXEntryActivity extends AbsWXCallbackActivity {
}
`,
      [wXPayEntryActivityFile]: `package ${$G.manifest.uapp.package}.wxapi;
import io.dcloud.feature.payment.weixin.AbsWXPayCallbackActivity;
public class WXPayEntryActivity extends AbsWXPayCallbackActivity{
}
`
    }

    for (const entryFile of [wxEntryActivityFile, wXPayEntryActivityFile]) {
      let replaceFile = path.join(
        $G.appDir,
        'app/src/main/java/',
        $G.manifest.uapp.package.replace(/\./g, '/'),
        'wxapi',
        entryFile
      )

      fs.mkdirSync(path.dirname(replaceFile), { recursive: true })
      fs.writeFileSync(replaceFile, contentOfEntryFiles[entryFile])
    }
  }

  replaceControlXml(path.join($G.appDir, 'app/src/debug/assets/data/dcloud_control.xml'))
  replaceControlXml(path.join($G.appDir, 'app/src/main/assets/data/dcloud_control.xml'))

  updateAndroidManifest()

  // 按 manifest modules / sdkConfigs 更新 android/app/sdk.libs（结果延后到构建末尾打印）
  const androidModuleNotice = updateAndroidModuleLibs({
    appDir: $G.appDir,
    sdkHomeDir: $G.sdkHomeDir,
    modules: $G.manifest['app-plus']?.modules,
    sdkConfigs: $G.manifest['app-plus']?.distribute?.sdkConfigs,
  })
  // 工程模板的 dcloud_properties.xml 只有 23 个 feature，按勾选模块从 SDK 的同名文件补注册
  const featurePatch = patchDcloudProperties({
    propsPath: path.join($G.appDir, 'app/src/main/assets/data/dcloud_properties.xml'),
    sdkPropsPath: path.join($G.sdkHomeDir, 'android/SDK/assets/data/dcloud_properties.xml'),
    modules: $G.manifest['app-plus']?.modules,
    sdkConfigs: $G.manifest['app-plus']?.distribute?.sdkConfigs,
  })
  // manifest 的 nativePlugins -> android/app/nativeplugins.libs（插件改名/新增后自动同步）
  const pluginLibs = updateAndroidNativePluginLibs({
    appDir: $G.appDir,
    webAppDir: $G.webAppDir,
    nativePlugins: $G.manifest['app-plus']?.nativePlugins,
  })
  // 同上的插件信息还要写进 dcloud_uniplugins.json，离线打包运行时靠它挂载插件
  const pluginRegistry = updateAndroidUniplugins({
    appDir: $G.appDir,
    webAppDir: $G.webAppDir,
    nativePlugins: $G.manifest['app-plus']?.nativePlugins,
  })
  // 插件 package.json 里的 maven 依赖与参数 -> app/build.gradle
  const pluginGradle = updateAndroidPluginGradle({
    appDir: $G.appDir,
    webAppDir: $G.webAppDir,
    nativePlugins: $G.manifest['app-plus']?.nativePlugins,
  })
  // UTS 插件 -> uniplugin_<id> 模块 + settings.gradle / app、根 build.gradle 接线
  const utsModules = updateAndroidUtsModules({
    appDir: $G.appDir,
    webAppDir: $G.webAppDir,
  })
  if (androidModuleNotice.errors?.length) {
    androidModuleNotice.errors.forEach((error) => console.log(chalk.red(error)))
    console.log(chalk.red('❌ Android 模块缺少权限声明，打包中止'))
    process.exit(1)
  }
  $G.androidModuleNotice = {
    ...androidModuleNotice,
    warnings: [...androidModuleNotice.warnings, ...featurePatch.warnings, ...pluginLibs.warnings, ...pluginRegistry.warnings, ...pluginGradle.warnings, ...utsModules.warnings],
    featureAdded: featurePatch.added,
    pluginAdded: pluginLibs.added,
    pluginRemoved: pluginLibs.removed,
    registryAdded: pluginRegistry.added,
    registryRemoved: pluginRegistry.removed,
    gradleAdded: pluginGradle.added,
    gradleRemoved: pluginGradle.removed,
    utsCreated: utsModules.created,
    utsUpdated: utsModules.updated,
    utsAdopted: utsModules.adopted,
    utsSkipped: utsModules.skipped,
    utsGradleAdded: utsModules.gradleAdded,
    utsGradleRemoved: utsModules.gradleRemoved,
    utsSettingsChanged: utsModules.settingsChanged,
    utsClasspathAdded: utsModules.classpathAdded,
    utsJitpackAdded: utsModules.jitpackAdded,
  }

  console.log('✅ updateAndroidMetaData')
}

// manifest 的 app-plus.distribute.android.minSdkVersion / targetSdkVersion -> app/build.gradle
function updateAndroidSdkVersions(content) {
  const android = $G.manifest['app-plus']?.distribute?.android
  const minSdkVersion = Number(android?.minSdkVersion)
  const targetSdkVersion = Number(android?.targetSdkVersion)

  if (Number.isFinite(minSdkVersion) && minSdkVersion > 0) {
    content = content.replace(/(^[ \t]*minSdk(?:Version)?\s+)(\d+)/m, '$1' + minSdkVersion)
  }
  if (Number.isFinite(targetSdkVersion) && targetSdkVersion > 0) {
    content = content.replace(/(^[ \t]*targetSdk(?:Version)?\s+)(\d+)/m, '$1' + targetSdkVersion)
  }

  return content
}

// manifest 的 permissions 里是完整的 <uses-permission .../> 行, 取里面的权限名
function androidPermissionName(entry) {
  const match = /android\.permission\.[A-Za-z0-9_.]+/.exec(String(entry || ''))
  return match ? match[0] : ''
}

// manifest 的 permissions 里可以带 android:maxSdkVersion / tools:ignore 等属性, 取原始标签而不是按名字重建
function androidPermissionTag(entry, name) {
  const tag = /<uses-permission\b[^>]*\/>/.exec(String(entry || ''))
  if (!tag || !new RegExp(`android:name="${escapeRe(name)}"`).test(tag[0])) return `<uses-permission android:name="${name}" />`
  return tag[0].replace(/\s+/g, ' ').replace(/\s*\/>$/, ' />')
}

// 解析 <uses-permission ... /> 里的属性, 保持出现顺序
function permissionAttrs(text) {
  const attrs = new Map()
  for (const [, key, value] of String(text).matchAll(/([A-Za-z][A-Za-z0-9_:.-]*)="([^"]*)"/g)) attrs.set(key, value)
  return attrs
}

// manifest 的 app-plus.distribute.android.permissions / excludePermissions / schemes -> AndroidManifest.xml
// permissions 只增不删 (工程里手工加的权限保留), excludePermissions 用 tools:node="remove" 排除
function updateAndroidManifest() {
  const android = $G.manifest['app-plus']?.distribute?.android
  const permissions = Array.isArray(android?.permissions) ? android.permissions : []
  const excludePermissions = Array.isArray(android?.excludePermissions) ? android.excludePermissions : []
  const schemes = toValueList(android?.schemes)
  // 勾选的模块在官方文档要求下需要的权限，自动补进 AndroidManifest.xml（excludePermissions 明确排除的不补）
  const modulePermissions = new Set()
  Object.keys($G.manifest['app-plus']?.modules || {}).forEach((moduleKey) => {
    ;(ANDROID_MODULE_PERMISSIONS[moduleKey] || []).forEach((name) => modulePermissions.add(name))
  })
  // 三方 provider 章节要求的权限（官方 geolocation/map/pay/share/speech/statistic 各页），同样受 excludePermissions 约束
  const androidSdkConfigs = $G.manifest['app-plus']?.distribute?.sdkConfigs || {}
  Object.keys(MODULE_SDK_CONFIG).forEach((moduleKey) => {
    if (!$G.manifest['app-plus']?.modules?.[moduleKey]) return
    const config = androidSdkConfigs[MODULE_SDK_CONFIG[moduleKey]]
    if (!config) return
    Object.keys(config).forEach((provider) => {
      ;(SDK_CONFIG_PERMISSIONS[MODULE_SDK_CONFIG[moduleKey]]?.[provider] || []).forEach((name) => modulePermissions.add(name))
    })
  })
  // 官方 others.html：targetSdkVersion 31 及以上勾选 Bluetooth/iBeacon 需追加 BLUETOOTH_SCAN/BLUETOOTH_CONNECT
  let gradleContent = null
  const gradleFile = path.join($G.appDir, 'app', 'build.gradle')
  if (fs.existsSync(gradleFile)) gradleContent = fs.readFileSync(gradleFile, 'utf8')
  const targetSdk = resolveAndroidTargetSdk(android?.targetSdkVersion, gradleContent)
  if (targetSdk === null || targetSdk >= 31) {
    ;['Bluetooth', 'iBeacon'].forEach((moduleKey) => {
      if ($G.manifest['app-plus']?.modules?.[moduleKey]) ANDROID_SDK31_PERMISSIONS.forEach((name) => modulePermissions.add(name))
    })
  }
  // 官方 others.html 要求的 uses-feature（Barcode/LivePusher 章节）
  const moduleUsesFeatures = new Set()
  Object.keys($G.manifest['app-plus']?.modules || {}).forEach((moduleKey) => {
    ;(ANDROID_MODULE_USES_FEATURES[moduleKey] || []).forEach((name) => moduleUsesFeatures.add(name))
  })
  excludePermissions.forEach((entry) => {
    const name = androidPermissionName(entry)
    if (name) modulePermissions.delete(name)
  })
  if (!permissions.length && !excludePermissions.length && !schemes.length && !modulePermissions.size && !moduleUsesFeatures.size) return

  const manifestFile = path.join($G.appDir, 'app/src/main/AndroidManifest.xml')
  if (!fs.existsSync(manifestFile)) return

  let content = fs.readFileSync(manifestFile, 'utf8')
  const original = content
  const permissionLineRe = /^[ \t]*<uses-permission\b[^>]*\/>[ \t]*$/gm
  const hasPermission = (name) => new RegExp(`<uses-permission[^>]*android:name="${escapeRe(name)}"`).test(content)

  const insertPermissionLine = (line) => {
    const matches = [...content.matchAll(permissionLineRe)]
    const indent = matches.length ? (/^[ \t]*/.exec(matches[0][0])[0]) : '  '
    if (matches.length) {
      const last = matches[matches.length - 1]
      const insertAt = last.index + last[0].length
      content = content.slice(0, insertAt) + '\n' + indent + line + content.slice(insertAt)
    } else {
      const applicationIndex = content.indexOf('<application')
      if (applicationIndex === -1) return
      content = content.slice(0, applicationIndex) + indent + line + '\n\n' + content.slice(applicationIndex)
    }
  }

  let addedPermissions = 0
  let syncedPermissions = 0
  permissions.forEach((entry) => {
    const name = androidPermissionName(entry)
    if (!name) return
    const tag = androidPermissionTag(entry, name)
    const declaredRe = new RegExp(`<uses-permission[^>]*android:name="${escapeRe(name)}"[^>]*/>`)
    const declared = declaredRe.exec(content)
    if (declared) {
      // 工程里已有同名行: manifest 里显式声明的属性值优先覆盖, 没声明的属性(手工加的 tools:ignore 等)保留
      if (/tools:node="remove"/.test(declared[0])) return
      const wanted = permissionAttrs(tag)
      const merged = permissionAttrs(declared[0])
      let changed = false
      wanted.forEach((value, key) => {
        if (key === 'android:name' || key === 'tools:node') return
        if (merged.get(key) !== value) {
          merged.set(key, value)
          changed = true
        }
      })
      if (changed) {
        const line = `<uses-permission ${[...merged].map(([key, value]) => `${key}="${value}"`).join(' ')} />`
        content = content.replace(declaredRe, () => line)
        syncedPermissions++
      }
      return
    }
    insertPermissionLine(tag)
    addedPermissions++
  })

  let addedModulePermissions = 0
  modulePermissions.forEach((name) => {
    if (hasPermission(name)) return
    insertPermissionLine(`<uses-permission android:name="${name}" />`)
    addedModulePermissions++
  })

  // uses-feature 插在 uses-permission/uses-feature 区块末尾，缩进对齐
  let addedUsesFeatures = 0
  if (moduleUsesFeatures.size) {
    const hasFeature = (name) => new RegExp(`<uses-feature[^>]*android:name="${escapeRe(name)}"`).test(content)
    const insertFeatureLine = (line) => {
      const matches = [...content.matchAll(/^[ \t]*<uses-(?:permission|feature)\b[^>]*\/>[ \t]*$/gm)]
      const indent = matches.length ? (/^[ \t]*/.exec(matches[0][0])[0]) : '  '
      if (matches.length) {
        const last = matches[matches.length - 1]
        const insertAt = last.index + last[0].length
        content = content.slice(0, insertAt) + '\n' + indent + line + content.slice(insertAt)
      } else {
        insertPermissionLine(line)
        return
      }
    }
    moduleUsesFeatures.forEach((name) => {
      if (hasFeature(name)) return
      insertFeatureLine(`<uses-feature android:name="${name}" />`)
      addedUsesFeatures++
    })
  }

  let excludedPermissions = 0
  excludePermissions.forEach((entry) => {
    const name = androidPermissionName(entry)
    if (!name) return
    const declaredRe = new RegExp(`<uses-permission[^>]*android:name="${escapeRe(name)}"[^>]*/>`)
    const declared = declaredRe.exec(content)
    if (declared) {
      if (/tools:node="remove"/.test(declared[0])) return
      // 保留原行的其它属性(如 maxSdkVersion / tools:ignore), 只追加 tools:node="remove"
      const removed = declared[0].replace(/\s*\/>$/, ' tools:node="remove" />')
      content = content.replace(declaredRe, () => removed)
      excludedPermissions++
      return
    }
    insertPermissionLine(`<uses-permission android:name="${name}" tools:node="remove" />`)
    excludedPermissions++
  })

  let addedSchemes = 0
  // scheme 要落在所有带 VIEW intent-filter 的 activity 里 (模板的 PandoraEntry 与 PandoraEntryActivity 都要有)
  const activityMatches = [...content.matchAll(/<activity\b[\s\S]*?<\/activity>/g)]
  activityMatches.reverse().forEach((match) => {
    const block = match[0]
    const viewOffset = block.indexOf('android.intent.action.VIEW')
    if (viewOffset === -1) return
    const filterEnd = block.indexOf('</intent-filter>', viewOffset)
    if (filterEnd === -1) return

    const beforeCloser = block.slice(0, filterEnd)
    const missing = schemes.filter((scheme) => {
      return !new RegExp(`<data[^>]*android:scheme="${escapeRe(scheme)}"`).test(block)
    })
    if (!missing.length) return

    // 插到 </intent-filter> 之前, 缩进对齐已有的 <data>, 没有就比闭合标签多两格
    const closerIndent = /[ \t]*$/.exec(beforeCloser)[0]
    const dataLine = /^[ \t]*<data\b/m.exec(beforeCloser)
    const dataIndent = dataLine ? (/^[ \t]*/.exec(dataLine[0])[0]) : closerIndent + '  '
    const text = missing.map((scheme) => `${dataIndent}<data android:scheme="${scheme}" />\n`).join('')
    const insertAt = match.index + filterEnd - closerIndent.length
    content = content.slice(0, insertAt) + text + closerIndent + content.slice(insertAt + closerIndent.length)
    addedSchemes += missing.length
  })

  if (schemes.length && !addedSchemes) {
    const stillMissing = schemes.filter((scheme) => {
      return !new RegExp(`<data[^>]*android:scheme="${escapeRe(scheme)}"`).test(content)
    })
    if (stillMissing.length) {
      console.log(chalk.yellow(`AndroidManifest.xml 里找不到带 VIEW intent-filter 的 activity，无法写入 scheme: ${stillMissing.join(', ')}`))
    }
  }

  if (content === original) return

  fs.writeFileSync(manifestFile, content)
  console.log(`✅ updateAndroidManifest (permissions: +${addedPermissions}, synced: ${syncedPermissions}, module: +${addedModulePermissions}, feature: +${addedUsesFeatures}, exclude: ${excludedPermissions}, schemes: +${addedSchemes})`)
}

function updateAndroidIcons(resDir) {
  const iconResourceDir = getIconResourceDir(resDir)
  // 72/96/144/192 分别对应 Android 四档密度，与 iOS 侧的跳过清单保持一致
  const densityIconMap = {
    hdpi: '72x72.png',
    xhdpi: '96x96.png',
    xxhdpi: '144x144.png',
    xxxhdpi: '192x192.png'
  }
  Object.keys(densityIconMap).forEach(function (density) {
    const iconFile = path.join(iconResourceDir, densityIconMap[density])
    if (!fs.existsSync(iconFile)) return
    sync(iconFile, path.join($G.appDir, `app/src/main/res/drawable-${density}/icon.png`))
  })
  console.log('✅ updateAndroidIcons')
}

function getIconResourceDir(resDir) {
  const keepIcons = path.join($G.appDir, 'icons')
  return fs.existsSync(keepIcons) && fs.statSync(keepIcons).isDirectory() ? keepIcons : resDir
}

/*
 * ios platform
 */

const IOS_BUILD_TYPES = ['base', 'test', 'sim', 'release']

// 每个构建类型写入的工程文件 (sim 与 base 共用 yml 和 Info.plist; test 的导出配置
// 由 uapp.ios.test.export 决定, 见 resolveIOSExportPlist)
const IOS_TARGET_FILES = {
  base: { yml: 'uapp_dev.yml', infoPlist: 'AppDev/Info.plist', exportPlist: 'export_dev.plist' },
  sim: { yml: 'uapp_dev.yml', infoPlist: 'AppDev/Info.plist' },
  test: { yml: 'uapp_test.yml', infoPlist: 'AppDev/Info.plist' },
  release: { yml: 'uapp_release.yml', infoPlist: 'AppRelease/Info.plist', exportPlist: 'export_release.plist' }
}

// test 的导出配置由 uapp.ios.test.export 决定:
//   dev (默认) 共用 export_dev.plist, 与 base 同一种导出方式 (调试包)
//   release    共用 export_release.plist, 与正式包同一种导出方式 (TestFlight / ad-hoc)
//   own        用 config/export_test.plist, method 与正式包不同时用
//              (如测试包 ad-hoc + 正式包 App Store)
// 签名值始终取自 uapp_test.yml, plist 里只有 method 等导出阶段配置需要人改
function resolveIOSExportPlist(buildType) {
  const files = IOS_TARGET_FILES[buildType]
  if (!files) return ''
  if (buildType !== 'test') return files.exportPlist || ''

  const follow = String($G.manifest.uapp?.ios?.test?.export || 'dev').trim()
  if (follow === 'dev') return 'export_dev.plist'
  if (follow === 'release') return 'export_release.plist'
  if (follow === 'own') {
    // own 要求工程里有 export_test.plist, 旧工程缺文件时不会自动补
    if (!fs.existsSync(path.join($G.appDir, 'config', 'export_test.plist'))) {
      console.log(chalk.red('uapp.ios.test.export=own 需要 config/export_test.plist，可从 export_dev.plist 复制后改 method'))
      process.exit(1)
    }
    return 'export_test.plist'
  }

  console.log(chalk.red(`uapp.ios.test.export 只能是 dev / release / own，当前: ${follow}`))
  process.exit(1)
}

// uapp.ios.{base|test|sim|release} 的 package/appkey; test/sim 未填的字段回退 base。
// google client id 绑定 bundle id: 正式包沿用 manifest 标准字段, 测试包包名不同,
// 在 uapp.ios.test.googleClientId 里单独写; 未填时回退 uapp.ios.base.googleClientId -> 标准字段
function resolveIOSConfig(buildType) {
  const ios = $G.manifest.uapp.ios || {}
  const base = ios.base || {}
  const own = ios[buildType] || {}
  const inheritsBase = buildType === 'test' || buildType === 'sim'
  const read = (obj, field) => String(obj[field] || '').trim()
  const ownPackage = read(own, 'package')
  const ownAppkey = read(own, 'appkey')
  const basePackage = inheritsBase ? read(base, 'package') : ''
  const baseAppkey = inheritsBase ? read(base, 'appkey') : ''
  const ownGoogle = read(own, 'googleClientId')
  const baseGoogle = inheritsBase ? read(base, 'googleClientId') : ''
  const manifestGoogle = String($G.manifest['app-plus']?.distribute?.sdkConfigs?.oauth?.google?.clientid || '').trim()

  return {
    package: ownPackage || basePackage,
    appkey: ownAppkey || baseAppkey,
    packageFromBase: !ownPackage && !!basePackage,
    appkeyFromBase: !ownAppkey && !!baseAppkey,
    googleClientId: ownGoogle || baseGoogle || manifestGoogle,
    googleSource: ownGoogle
      ? `uapp.ios.${buildType}.googleClientId`
      : baseGoogle
        ? 'uapp.ios.base.googleClientId'
        : manifestGoogle ? 'sdkConfigs.oauth.google.clientid' : ''
  }
}

function requireIOSConfig(buildType) {
  if (!IOS_BUILD_TYPES.includes(buildType)) {
    console.log(chalk.red(`无效的 iOS 构建类型: ${buildType || '(未指定)'}`))
    console.log(`示例: ${IOS_BUILD_TYPES.join(', ')}`)
    process.exit(1)
  }

  const config = resolveIOSConfig(buildType)
  const missing = []
  if (!config.package) missing.push('package')
  if (!config.appkey) missing.push('appkey')
  if (missing.length > 0) {
    const fields = missing.join(' / ')
    const hint = buildType === 'test' || buildType === 'sim'
      ? `uapp.ios.${buildType}.{${fields}} 与 uapp.ios.base.{${fields}} 均未配置`
      : `uapp.ios.${buildType}.{${fields}} 未配置`
    console.log(chalk.red(`缺少 iOS ${buildType} 构建配置: ${hint}`))
    console.log('base / release 必填；test / sim 未填时回退 base')
    process.exit(1)
  }

  return config
}

function updateIOSMetaData() {
  const rawBuildType = $G.args.argv.remain[2] || ''
  // uapp prepare 没有构建类型 (或沿用 android 的 dev), 无法确定 package/appkey, 只做与类型无关的更新
  const isPrepare = $G.args.argv.remain[0] === 'prepare'
  const config = isPrepare && !IOS_BUILD_TYPES.includes(rawBuildType) ? null : requireIOSConfig(rawBuildType)
  const targetFiles = config ? IOS_TARGET_FILES[rawBuildType] : null

  if (config) {
    $G.manifest.uapp.package = config.package
    $G.manifest.uapp.appkey = config.appkey
    updateIOSBundleId(targetFiles.yml, config.package)
    // 签名信息以 target yml 为准, 导出 plist 只保留 method 等导出阶段专属配置
    const exportPlist = resolveIOSExportPlist(rawBuildType)
    const signing = readIOSSigningSettings(targetFiles.yml)
    const method = updateIOSExportProfile(exportPlist, config.package, signing)
    // debugging 以外的导出方式 (app-store-connect / ad-hoc / enterprise) 都要发布证书
    if (method && method !== 'debugging' && signing.signingCertificate && !/distribution/i.test(signing.signingCertificate)) {
      console.log(chalk.yellow(`${exportPlist} 的 method 是 ${method}, 但 ${targetFiles.yml} 的 CODE_SIGN_IDENTITY 是 ${signing.signingCertificate}, 需要发布证书才能导出`))
    }
  } else {
    console.log(chalk.yellow('未指定 iOS 构建类型，跳过包名 / appkey 写入'))
    console.log('打包请用 uapp run build:app-plus base|test|sim|release')
  }

  let sdkLinkDir = path.join($G.appDir, '/SDKs/SDK')
  if (!fs.existsSync(sdkLinkDir)) {
    let iosSDKDir = path.join($G.sdkHomeDir, '/ios/SDK')
    if (!fs.existsSync(iosSDKDir)) {
      console.log('找不到iOS SDK，请参照 README 配置')
      console.log('SDK 位置: ' + iosSDKDir)
    } else {
      fs.symlinkSync(path.join($G.sdkHomeDir, '/ios/SDK'), sdkLinkDir, 'dir')
    }
  }

  // 先确定 Pod 模式 (可能改写 base.yml) 再同步版本号
  setupIOSPodMode()
  updateIOSVersions()

  // 两个 Info.plist (AppDev / AppRelease) 都按 manifest 同步: 条目标题以 manifest 为准,
  // 只更新当前构建类型会留下另一个 plist 的旧值 (release 包悄悄用旧文案)
  syncInfoPlistContent()
  // Xcode 工程属性 DEVELOPMENT_LANGUAGE 同样以 manifest 为准 (不影响构建产物)
  updateIOSDevelopmentLanguage()
  // 能力声明按 manifest 的模块开关生成: 没勾 Push 就不该带 aps-environment,
  // 没配苹果登录就不该带 applesignin, 否则签名时和 App ID 对不上
  const entitlementFiles = syncIOSEntitlements()
  if (entitlementFiles.length) console.log(`✅ iOS entitlements 已按 manifest 更新: ${entitlementFiles.join(', ')}`)
  if (syncIOSCapabilities()) console.log('✅ iOS 能力声明已按 manifest 更新 (config/base.yml 的 SystemCapabilities)')

  replaceControlXml(path.join($G.appDir, 'Main/Resources/AppDev/control.xml'))
  replaceControlXml(path.join($G.appDir, 'Main/Resources/AppRelease/control.xml'))

  const idfa = $G.manifest['app-plus']?.distribute?.ios?.idfa
  const privacy = $G.manifest['app-plus']?.distribute?.ios?.privacyDescription || {}
  if (idfa === true && !privacy.NSUserTrackingUsageDescription) {
    console.log(chalk.yellow('manifest 里 idfa=true, 但没有配置 NSUserTrackingUsageDescription 隐私文案, 上架审核会被拒'))
  }

  console.log(config ? `✅ updateIOSMetaData (${rawBuildType}: ${config.package})` : '✅ updateIOSMetaData (未指定构建类型: 包名/appkey 未写, 版本/Info.plist/entitlements 已同步)')
}

// manifest.fallbackLocale -> Xcode 工程语言属性, 两层都同步 (都不影响构建产物):
// 1. config/base.yml 的 DEVELOPMENT_LANGUAGE (target build setting, 只供 Info.plist 的 $(DEVELOPMENT_LANGUAGE) 展开)
// 2. project.yml 的 options.developmentLanguage (pbxproj 的 developmentRegion, 即 Xcode 的 Default Localization 显示,
//    避免打开 Xcode 后误会语言没改; 无 options 段时自动补)
// 行不存在或值相同则不动; manifest 未配置 fallbackLocale 时保留各自静态值作兜底
function updateIOSDevelopmentLanguage() {
  const language = String($G.manifest.fallbackLocale || '').trim()
  if (!language) return
  let changed = false

  const baseFile = path.join($G.appDir, 'config/base.yml')
  if (fs.existsSync(baseFile)) {
    const content = fs.readFileSync(baseFile, 'utf8')
    const re = /^([ \t]*DEVELOPMENT_LANGUAGE:[ \t]*).+$/m
    if (re.test(content)) {
      const updated = content.replace(re, (match, head) => head + language)
      if (updated !== content) {
        fs.writeFileSync(baseFile, updated)
        changed = true
      }
    }
  }

  const projectFile = path.join($G.appDir, 'project.yml')
  if (fs.existsSync(projectFile)) {
    const content = fs.readFileSync(projectFile, 'utf8')
    const lineRe = /^([ \t]*developmentLanguage:[ \t]*).+$/m
    let updated = content
    if (lineRe.test(content)) {
      updated = content.replace(lineRe, (match, head) => head + language)
    } else if (/^options:[ \t]*$/m.test(content)) {
      // 已有 options 段但没写 developmentLanguage: 在 options: 下插一行
      updated = content.replace(/^options:[ \t]*$/m, (match) => `${match}\n  developmentLanguage: ${language}`)
    } else if (!/^options:/m.test(content) && /^name:/m.test(content)) {
      // 没有 options 段: 在 name: 后补整段 (options 内联写法不碰, 避免插出双键)
      updated = content.replace(/^(name:[ \t]*.+)$/m, `$1\n\noptions:\n  developmentLanguage: ${language}`)
    }
    if (updated !== content) {
      fs.writeFileSync(projectFile, updated)
      changed = true
    }
  }

  if (changed) console.log(`✅ updateIOSDevelopmentLanguage (${language})`)
}

// entitlements 里的能力项按 manifest 模块开关生成, 只动这两个键, 其它能力保持用户手写内容
// 离线推送 (APNs) 是否启用: 勾了 Push 模块, 且推送配置里 offline=true
function iosOfflinePushEnabled() {
  const appPlus = $G.manifest['app-plus'] || {}
  const hasPushModule = Object.keys(appPlus.modules || {}).some((key) => /^push$/i.test(key))
  const push = appPlus.distribute?.sdkConfigs?.push || {}
  const offline = Object.keys(push).some((key) => push[key] && push[key].offline === true)
  return hasPushModule && offline
}

function syncIOSEntitlements() {
  const modules = $G.manifest['app-plus']?.modules || {}
  const sdkConfigs = $G.manifest['app-plus']?.distribute?.sdkConfigs || {}
  const hasPush = iosOfflinePushEnabled()
  const hasAppleSignIn = !!(sdkConfigs.oauth && sdkConfigs.oauth.apple)
  const flavors = [
    ['uapp_dev.yml', 'development'],
    ['uapp_test.yml', 'development'],
    ['uapp_release.yml', 'production']
  ]
  const changed = []
  for (const [file, aps] of flavors) {
    const full = path.join($G.appDir, 'config', file)
    if (!fs.existsSync(full)) continue
    const before = fs.readFileSync(full, 'utf8')
    const after = writeEntitlementProperties(before, {
      'aps-environment': hasPush ? aps : null,
      'com.apple.developer.applesignin': hasAppleSignIn ? ['Default'] : null
    })
    if (after !== before) {
      fs.writeFileSync(full, after)
      changed.push(file)
    }
  }
  return changed
}

// 在 entitlements.properties 下增删指定键; 值为 null 表示删除该键
function writeEntitlementProperties(content, values) {
  const lines = content.split('\n')
  // 上一次删空时写成了 properties: {}, 重开能力要从 {} 里恢复, 两种形态都认
  const propIndex = lines.findIndex((line) => /^\s+properties:\s*(\{\})?\s*$/.test(line))
  if (propIndex === -1) return content
  if (/\{\}/.test(lines[propIndex])) lines[propIndex] = lines[propIndex].replace(/\s*\{\}\s*$/, '')
  const propIndent = /^\s*/.exec(lines[propIndex])[0].length
  const willAdd = Object.values(values).some((value) => value !== null)
  let keyIndent = null
  for (let i = propIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    const indent = /^\s*/.exec(line)[0].length
    if (indent <= propIndent) break
    keyIndent = indent
    break
  }
  if (keyIndent === null && !willAdd) {
    // 没有能力项且本次不新增键时保持 properties: {} (空值会让 xcodegen 报 Incorrect type);
    // 要新增键时保持裸 properties:, 键直接挂在行下
    const next = lines.slice(propIndex + 1).find((line) => line.trim())
    if (!next || /^\s*/.exec(next)[0].length <= propIndent) {
      lines[propIndex] = ' '.repeat(propIndent) + 'properties: {}'
    }
  }
  if (keyIndent === null) keyIndent = propIndent + 4

  for (const [key, value] of Object.entries(values)) {
    const keyRe = new RegExp(`^\\s+${key.replace(/\./g, '\\.')}\\s*:`)
    const index = lines.findIndex((line) => keyRe.test(line))
    if (value === null) {
      if (index !== -1) {
        const indent = /^\s*/.exec(lines[index])[0].length
        let end = index + 1
        while (end < lines.length && (lines[end].trim() === '' || /^\s*/.exec(lines[end])[0].length > indent)) {
          if (lines[end].trim() === '' && end + 1 < lines.length && /^\s*/.exec(lines[end + 1])[0].length <= indent) break
          end += 1
        }
        lines.splice(index, end - index)
      }
      continue
    }
    const pad = ' '.repeat(keyIndent)
    const body = Array.isArray(value)
      ? [`${pad}${key}:`, ...value.map((item) => `${pad}    - ${item}`)]
      : [`${pad}${key}: ${value}`]
    if (index === -1) {
      lines.splice(propIndex + 1, 0, ...body)
    } else {
      const indent = /^\s*/.exec(lines[index])[0].length
      let end = index + 1
      while (end < lines.length && (lines[end].trim() === '' || /^\s*/.exec(lines[end])[0].length > indent)) end += 1
      // 内容没变就不重写, 避免每次 prepare 打乱键顺序
      const current = Array.isArray(value)
        ? lines.slice(index + 1, end).map((line) => line.trim()).filter(Boolean).map((line) => line.replace(/^-\s*/, ''))
        : [lines[index].slice(lines[index].indexOf(':') + 1).trim()]
      const wanted = Array.isArray(value) ? value : [String(value)]
      if (current.length === wanted.length && current.every((item, i) => item === String(wanted[i]))) continue
      lines.splice(index, end - index, ...body)
    }
  }
  // 删完键后 properties 变空 -> 写成 {}; properties 块到下一个缩进 <= propIndent 的非空行为止,
  // 不能扫到文件尾: settings/sources 的子行缩进都比 propIndent 大, 恒判成还有键
  let stillKey = false
  for (let i = propIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    stillKey = /^\s*/.exec(line)[0].length > propIndent
    break
  }
  if (!stillKey) lines[propIndex] = ' '.repeat(propIndent) + 'properties: {}'
  return lines.join('\n')
}

// config/base.yml 的 attributes.SystemCapabilities: 只声明 manifest 里真正启用的能力
function syncIOSCapabilities() {
  const file = path.join($G.appDir, 'config/base.yml')
  if (!fs.existsSync(file)) return false
  const before = fs.readFileSync(file, 'utf8')
  const lines = before.split('\n')
  const caps = []
  if (iosOfflinePushEnabled()) caps.push('com.apple.Push')
  const oauth = $G.manifest['app-plus']?.distribute?.sdkConfigs?.oauth
  if (oauth && oauth.apple) caps.push('com.apple.AppleIDSignIn')
  const block = caps.length
    ? ['        attributes:', '            SystemCapabilities:', ...caps.map((cap) => `                ${cap}: 1`)]
    : []
  const start = lines.findIndex((line) => /^ {8}attributes:\s*$/.test(line))
  if (start === -1) {
    // 模板里没有 attributes 块: 需要能力时插在 settings: 之前
    if (!block.length) return false
    const at = lines.findIndex((line) => /^ {8}settings:\s*$/.test(line))
    if (at === -1) return false
    lines.splice(at, 0, ...block)
    fs.writeFileSync(file, lines.join('\n'))
    return true
  }
  let end = start + 1
  while (end < lines.length && (lines[end].trim() === '' || /^\s*/.exec(lines[end])[0].length > 8)) end += 1
  if (lines.slice(start, end).join('\n') === block.join('\n')) return false
  lines.splice(start, end - start, ...block)
  fs.writeFileSync(file, lines.join('\n'))
  return true
}

// CoreMotion.framework 只在选中的 subspec 真的引用 CM* 符号时才让工程链接:
// 官方 podspec 的 Accelerometer (只声明 Accelerate)、Payment-Paypal、Geolocation-Tencent 都漏了这条依赖,
// 而工程开了 -ObjC, 静态库里的 CMMotionManager 未定义符号必须解析 -> 按当前 subspecs 动态增删 base.yml 条目。
const CORE_MOTION_ENTRY = '            - sdk: CoreMotion.framework'

function syncIOSSystemFrameworks(subspecs) {
  const file = path.join($G.appDir, 'config/base.yml')
  if (!fs.existsSync(file)) return false
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const want = (subspecs || []).some((name) => CORE_MOTION_SUBSPECS.includes(name))
  const entryAt = lines.findIndex((line) => line.trim() === '- sdk: CoreMotion.framework')
  if (want === (entryAt !== -1)) return false

  // dependencies 块的范围: 从 `dependencies:` 到下一个缩进 <= 8 的非空行 (settings/sources 等)
  const blockEnd = (start) => {
    let end = start + 1
    while (end < lines.length && (lines[end].trim() === '' || /^\s*/.exec(lines[end])[0].length > 8)) end += 1
    return end
  }

  if (want) {
    const depAt = lines.findIndex((line) => /^ {8}dependencies:\s*$/.test(line))
    if (depAt === -1) {
      const at = lines.findIndex((line) => /^ {8}settings:\s*$/.test(line))
      if (at === -1) return false
      lines.splice(at, 0, '        dependencies:', CORE_MOTION_ENTRY, '')
    } else {
      const end = blockEnd(depAt)
      let last = depAt
      for (let i = depAt + 1; i < end; i += 1) if (lines[i].trim()) last = i
      lines.splice(last + 1, 0, CORE_MOTION_ENTRY)
    }
  } else {
    lines.splice(entryAt, 1)
    // 只剩空键时整块删掉: 空 dependencies 会让 xcodegen 报错
    const depAt = lines.findIndex((line) => /^ {8}dependencies:\s*$/.test(line))
    if (depAt !== -1) {
      const end = blockEnd(depAt)
      if (!lines.slice(depAt + 1, end).some((line) => line.trim())) lines.splice(depAt, end - depAt)
    }
  }
  fs.writeFileSync(file, lines.join('\n'))
  return true
}

// PandoraApi.bundle 由 uniapp.podspec 从共享 SDK 原样拷进包, 直接改共享 SDK 会把补丁
// 串给同机其他工程; 所以补丁结果落在工程 config/feature.plist, 由这个 phase 在构建时覆盖进包。
// 顺序关键: 必须晚于 [CP] Copy Pods Resources, 否则会被 Pod 拷回原版, 顺序由 Podfile 的 post_install 调整。
const FEATURE_PLIST_PHASE = [
  '            - name: uapp-feature-plist',
  '              script: |',
  '                SRC="${SRCROOT}/config/feature.plist"',
  '                DST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/PandoraApi.bundle/feature.plist"',
  '                if [ -f "$SRC" ] && [ -d "$(dirname "$DST")" ]; then',
  '                    cp -f "$SRC" "$DST"',
  '                fi',
]

function syncIOSFeaturePlistPhase() {
  const file = path.join($G.appDir, 'config/base.yml')
  if (!fs.existsSync(file)) return false
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  if (lines.some((line) => /^\s*-\s*name:\s*uapp-feature-plist\s*$/.test(line))) return false
  const at = lines.findIndex((line) => /^ {8}postBuildScripts:\s*$/.test(line))
  if (at === -1) return false
  let end = at + 1
  while (end < lines.length && (lines[end].trim() === '' || /^\s*/.exec(lines[end])[0].length > 8)) end += 1
  let last = at
  for (let i = at + 1; i < end; i += 1) if (lines[i].trim()) last = i
  lines.splice(last + 1, 0, ...FEATURE_PLIST_PHASE)
  fs.writeFileSync(file, lines.join('\n'))
  return true
}

function updateIOSVersions() {
  const versionName = normalizeVersionName($G.manifest.uapp.versionName)
  const file = path.join($G.appDir, 'config', 'base.yml')
  if (!fs.existsSync(file)) return
  let content = fs.readFileSync(file, 'utf8')
  content = content.replace(/(MARKETING_VERSION: )(.*)/g, '$1' + versionName)
  content = content.replace(/(CURRENT_PROJECT_VERSION: )(.*)/g, '$1' + $G.manifest.uapp.versionCode)
  fs.writeFileSync(file, content)
}

// 两个 Info.plist: AppDev (base/test/sim) 与 AppRelease (release).
// 应用名、appkey、权限文案、本地化、方向、URL scheme 都以 manifest 为准, 两个文件一起同步,
// 否则换构建类型时另一个 plist 会留着上一次的旧值
function syncInfoPlistContent() {
  const flavors = [
    ['base', 'AppDev/Info.plist'],
    ['release', 'AppRelease/Info.plist']
  ]
  for (const [buildType, rel] of flavors) {
    const file = path.join($G.appDir, 'Main/Resources', rel)
    if (!fs.existsSync(file)) continue
    const config = resolveIOSConfig(buildType)
    replaceInfoPlist(file, config.appkey || $G.manifest.uapp.appkey)
    updateIOSPrivacyDescription(file)
    updateIOSLocalizations(file)
    updateIOSScreenOrientation(file)
    updateIOSUrlSchemes(file, config.googleClientId, config.googleSource)
    updateIOSNativePlugins(file)
  }
}

// Pod 模式下工程的 HEADER_SEARCH_PATHS 会覆盖 Pods 的 xcconfig, 导致 SDK 头文件路径丢失,
// 给每一处手写的 HEADER_SEARCH_PATHS 补 $(inherited) (已有则跳过)
function ensureInheritedHeaderPaths() {
  const file = path.join($G.appDir, 'config', 'custom.yml')
  if (!fs.existsSync(file)) return 0
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  let fixed = 0
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s+)HEADER_SEARCH_PATHS:\s*$/.exec(lines[i])
    if (!match) continue
    // 沿用已有列表项的缩进 (列表项通常比键多 2~4 格, 不能假设固定值)
    let indent = `${match[1]}  `
    let j = i + 1
    if (j < lines.length) {
      const itemIndent = /^(\s*)- /.exec(lines[j])
      if (itemIndent) indent = itemIndent[1]
    }
    let hasInherited = false
    while (j < lines.length && /^\s+- /.test(lines[j])) {
      if (lines[j].includes('$(inherited)')) hasInherited = true
      j++
    }
    if (hasInherited) continue
    lines.splice(i + 1, 0, `${indent}- "$(inherited)"`)
    fixed++
    i++
  }
  if (fixed) fs.writeFileSync(file, lines.join('\n'))
  return fixed
}

// dependencies:/sources: 条目删空后, 只剩键名会让 xcodegen 报 expected Array<Any>, 把空键一并删掉
function dropEmptyCollectionKeys(lines) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(dependencies|sources):\s*$/.test(lines[i])) {
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') j++
      const keyIndent = /^\s*/.exec(lines[i])[0].length
      const nextIndent = j < lines.length ? /^\s*/.exec(lines[j])[0].length : -1
      if (nextIndent <= keyIndent) continue
    }
    out.push(lines[i])
  }
  return out
}

// 删掉空的分组注释块 (# X-start 紧跟 # X-end): Pod 版 base.yml 去掉 SDK 条目后这批注释会空掉
function dropEmptyMarkerBlocks(lines) {
  let changed = true
  while (changed) {
    changed = false
    const out = []
    for (let i = 0; i < lines.length; i++) {
      const start = /^(\s*)# (.+)-start\s*$/.exec(lines[i])
      if (start) {
        let j = i + 1
        while (j < lines.length && lines[j].trim() === '') j++
        const end = j < lines.length ? /^(\s*)# (.+)-end\s*$/.exec(lines[j]) : null
        if (end && end[2] === start[2]) {
          i = j
          changed = true
          continue
        }
      }
      out.push(lines[i])
    }
    lines = out
  }
  return lines
}

// 单一 base.yml: Pod 模式下就地删掉手写 SDK 依赖与搜索路径, 其余 target 配置保持不动。
// 幂等: 已经是 Pod 版时第二次调用不会改动文件。
function podifyConfigYml(file, { keepLdf }) {
  if (!fs.existsSync(file)) return { changed: false, removed: 0, customSettings: [] }
  const original = fs.readFileSync(file, 'utf8')
  const lines = original.split('\n')
  const skipSettings = new Set(['FRAMEWORK_SEARCH_PATHS', 'LIBRARY_SEARCH_PATHS', 'HEADER_SEARCH_PATHS'])
  const kept = []
  let removed = 0
  // 整键删除会带走所有非 SDK 路径 (含模板默认的系统变量), 记下来由 setupIOSPodMode 提示
  const customSettings = []
  let sawLdf = false
  let ldfIndent = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const entry = /^(\s+)- (?:framework|path):\s+\S*SDKs\/SDK\//.exec(line)
    if (entry) {
      removed++
      const indent = entry[1].length
      // 条目附带的续行 (embed/codeSign/buildPhase/weak 等)
      while (i + 1 < lines.length) {
        const next = lines[i + 1]
        if (next.trim() === '') break
        if (/^\s*- /.test(next)) break
        if (/^\s*/.exec(next)[0].length <= indent) break
        i++
      }
      continue
    }
    // 模板早期遗留的自定义构建项, 没有任何地方读它 (显示名在 Info.plist 的 CFBundleDisplayName)
    if (/^\s+DISPLAY_NAME:/.test(line)) {
      removed++
      continue
    }
    const setting = /^(\s+)([A-Z_]+):\s*(.*)$/.exec(line)
    if (setting && skipSettings.has(setting[2])) {
      removed++
      const indent = setting[1].length
      while (i + 1 < lines.length) {
        const next = lines[i + 1]
        if (next.trim() === '') break
        if (/^\s*/.exec(next)[0].length <= indent) break
        if (/^\s+- /.test(next) && !/SDKs\/SDK\//.test(next) && !/\$\(inherited\)/.test(next)) {
          customSettings.push(`${setting[2]} 的 ${next.trim()}`)
        }
        i++
      }
      continue
    }
    // -ObjC 仍要保留 (分类方法), 但要带上 $(inherited), 否则会盖掉 Pods xcconfig 里的其他链接参数;
    // flavor 文件里如果有 OTHER_LDFLAGS 同样会覆盖 xcconfig, 所以四个文件都按这个规则改
    const ldf = /^(\s+)OTHER_LDFLAGS:\s*(.+)$/.exec(line)
    if (ldf) {
      sawLdf = true
      ldfIndent = ldf[1]
      const value = ldf[2].trim().replace(/^'(.*)'$/, '$1')
      const flags = value.split(/\s+/).filter((flag) => flag && flag !== '$(inherited)')
      if (!flags.includes('-ObjC')) flags.unshift('-ObjC')
      kept.push(`${ldf[1]}OTHER_LDFLAGS: '$(inherited) ${flags.join(' ')}'`)
      continue
    }
    const defs = /^(\s+)GCC_PREPROCESSOR_DEFINITIONS:\s*(.+)$/.exec(line)
    if (defs && !defs[2].includes('$(inherited)')) {
      const value = defs[2].trim().replace(/^'(.*)'$/, '$1')
      kept.push(`${defs[1]}GCC_PREPROCESSOR_DEFINITIONS: '$(inherited) ${value}'`)
      continue
    }
    kept.push(line)
  }
  let merged = dropEmptyCollectionKeys(kept)
  // 老工程可能上一版 Pod 化时把 OTHER_LDFLAGS 整行删了, 这里补回来
  if (keepLdf && !sawLdf) {
    const index = merged.findIndex((line) => /GCC_PREPROCESSOR_DEFINITIONS:/.test(line))
    if (index >= 0) {
      const indent = /^\s*/.exec(merged[index])[0]
      merged = [...merged.slice(0, index + 1), `${indent}OTHER_LDFLAGS: '$(inherited) -ObjC'`, ...merged.slice(index + 1)]
    }
  }
  const content = dropEmptyMarkerBlocks(merged).join('\n')
  if (content === original) return { changed: false, removed: 0, customSettings: [] }
  fs.writeFileSync(file, content)
  return { changed: true, removed, customSettings }
}

// base.yml 与三个 flavor 配置都可能带手写 SDK 依赖: 一次性清掉, 否则 flavor 里的条目会绕过 Pod
function podifyConfigs() {
  const files = ['base.yml', 'uapp_dev.yml', 'uapp_test.yml', 'uapp_release.yml']
  const changedFiles = []
  let removed = 0
  const customSettings = []
  for (const name of files) {
    const result = podifyConfigYml(path.join($G.appDir, 'config', name), { keepLdf: name === 'base.yml' })
    customSettings.push(...result.customSettings)
    if (result.changed) {
      changedFiles.push(`config/${name}`)
      removed += result.removed
    }
  }
  return { changed: changedFiles.length > 0, changedFiles, removed, customSettings }
}

// Pod 模式专属: 删掉 custom.yml 里手写的 SDK 依赖条目 (含其 embed/codeSign 续行),
// 这些库现在由 uniapp.podspec 提供, 留着会和 Pod 重复链接/重复嵌入
function stripPodModeSDKEntries() {
  const file = path.join($G.appDir, 'config', 'custom.yml')
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const removed = []
  const kept = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s+- (?:framework|path):\s+(SDKs\/(?:SDK|GoogleOAuth)\/\S+)/.exec(lines[i])
    if (!match) {
      kept.push(lines[i])
      continue
    }
    removed.push(match[1])
    const entryIndent = /^\s*/.exec(lines[i])[0].length
    // 只吃比条目更深的续行 (embed/codeSign/buildPhase 等), 遇到同级键/下一个条目就停
    while (i + 1 < lines.length) {
      const next = lines[i + 1]
      if (next.trim() === '') break
      if (/^\s*/.exec(next)[0].length <= entryIndent) break
      i++
    }
  }
  if (removed.length) fs.writeFileSync(file, dropEmptyCollectionKeys(kept).join('\n'))
  return removed
}

// 工程里的 SDKs/SDK 软链: 默认 SDK 目录只有 podspec 没有 SDK/ 时, 改指配置的完整 SDK
function relinkProjectSDK(sdkDir) {
  const link = path.join($G.appDir, 'SDKs/SDK')
  let stat = null
  try {
    stat = fs.lstatSync(link)
  } catch (e) {
    stat = null
  }
  // 用户把真实 SDK 目录放进工程时不动它, 只有软链才改指向
  if (stat && !stat.isSymbolicLink()) {
    console.log(chalk.yellow(`${link} 不是软链, 保留原样; Pod 仍从该目录的 uniapp.podspec 解析依赖`))
    return
  }
  if (stat) fs.rmSync(link, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(link), { recursive: true })
  fs.symlinkSync(sdkDir, link, 'dir')
}

// Pod 模式: SDK 依赖交给官方 uniapp.podspec, 工程结构与三套 target 仍由 XcodeGen 负责。
// 前提是完整离线 SDK 根目录 (含 uniapp.podspec): 默认 ~/.uappsdk/ios, 可用 uapp config set ios.sdk 指定
function setupIOSPodMode() {
  const configured = $G.config?.['ios.sdk']
  let sdkRoot = isPodSDKRoot(configured) ? configured : resolvePodSDKRoot($G.sdkHomeDir)
  // 完整 SDK 在别处配置时, 把 pod 依赖需要的 uniapp.podspec 与 license.md 补进 uapp 的 SDK 目录,
  // 之后就不再依赖这条 config, 换台机器只拷 SDK/ 也能直接用 Pod 模式
  if (isPodSDKRoot(configured) && !resolvePodSDKRoot($G.sdkHomeDir)) {
    const ensured = ensurePodSDKFiles({ sdkHomeDir: $G.sdkHomeDir, sourceRoot: configured })
    if (ensured?.root) {
      sdkRoot = ensured.root
      console.log(`✅ 已从 ${configured} 复制 uniapp.podspec 与 license.md 到 ${ensured.root}`)
      if (ensured.versionMismatch) {
        console.log(chalk.yellow(`⚠️ 两处 SDK 版本不一致 (${ensured.sourceVersion} vs ${ensured.targetVersion}), 请确认 ${path.join(ensured.root, 'SDK')} 与 podspec 配套`))
      }
    } else if (ensured?.sdkMissing && fs.existsSync(path.join(configured, 'SDK'))) {
      // 默认目录没有 SDK/ 时不能只补 podspec (podspec 的 lib 路径是相对它自己的 SDK/Libs), 直接用配置的完整 SDK
      sdkRoot = configured
      relinkProjectSDK(path.join(configured, 'SDK'))
      console.log(`✅ 工程 SDK 指向 ${configured}/SDK`)
    }
  }
  // SDK 依赖只有 uniapp.podspec 一个来源: 找不到完整 SDK 就停下, 不再退回手写依赖表
  if (!sdkRoot) {
    if (configured) {
      console.log(chalk.red(`uapp config 的 ios.sdk 不是完整 iOS 离线 SDK (需要 uniapp.podspec 与 SDK/): ${configured}`))
    } else {
      console.log(chalk.red(`未找到完整的 iOS 离线 SDK: ${path.join($G.sdkHomeDir, 'ios')} 缺少 uniapp.podspec 或 SDK/`))
    }
    console.log(chalk.red('iOS 构建依赖 CocoaPods, 请把完整离线 SDK 放到 ~/.uappsdk/ios, 或执行 uapp config set ios.sdk <包含 uniapp.podspec 与 SDK/ 的目录>'))
    process.exit(1)
  }
  // 只用一份 config/base.yml: Pod 模式下就地删掉手写 SDK 依赖与搜索路径 (幂等),
  // 依赖只有 Pod 一条通道: base.yml 就地改成 Pod 版 (无手写 SDK 依赖), 不再维护 base-pod.yml
  const podified = podifyConfigs()
  if (podified.changed) {
    console.log(chalk.yellow(`Pod 模式已把 ${podified.changedFiles.join(', ')} 改成 Pod 版 (删除 ${podified.removed} 条手写 SDK 依赖/搜索路径)`))
  }
  if (podified.customSettings.length) {
    console.log(chalk.yellow(`⚠️ FRAMEWORK/LIBRARY/HEADER_SEARCH_PATHS 是整键删除, 以下非 SDK 条目也被带走: ${podified.customSettings.join(' ; ')} (如仍需要, 请移到 Podfile 的 post_install 或 Pods xcconfig)`))
  }
  // 老工程可能还停在 base-pod.yml 的 include 上
  const projectFile = path.join($G.appDir, 'project.yml')
  let projectContent = fs.readFileSync(projectFile, 'utf8')
  if (projectContent.includes('path: config/base-pod.yml')) {
    fs.writeFileSync(projectFile, projectContent.replace('path: config/base-pod.yml', 'path: config/base.yml'))
  }

  // 手写依赖表必须退场: custom.yml 里指向 SDK/Libs、SDK/Bundles 的条目会与 podspec 重复,
  // 自签的 SDKs/GoogleOAuth 副本同理 (文件保留, 打包前由 ensureSignedGoogleFrameworks 同步回 SDK)
  const inheritedAdded = ensureInheritedHeaderPaths()
  if (inheritedAdded) {
    console.log(chalk.yellow(`Pod 模式已给 config/custom.yml 的 ${inheritedAdded} 处 HEADER_SEARCH_PATHS 补上 $(inherited) (否则会覆盖 Pods 的头文件路径)`))
  }

  const stripped = stripPodModeSDKEntries()
  if (stripped.length) {
    console.log(chalk.yellow(`Pod 模式已从 config/custom.yml 移除手写 SDK 依赖 (改由 uniapp.podspec 提供): ${stripped.join(', ')}`))
  }

  // Pod 只负责依赖: 隐私文案、三方 key、feature.plist、UTS 仍走 uapp 原有逻辑
  const { subspecs, warnings: subspecWarnings } = podSubspecs({
    modules: $G.manifest['app-plus']?.modules,
    sdkConfigs: $G.manifest['app-plus']?.distribute?.sdkConfigs
  })
  writePodfile({ appDir: $G.appDir, subspecs, targets: readIOSTargets($G.appDir) })
  if (syncIOSSystemFrameworks(subspecs)) console.log('✅ iOS 系统框架依赖已按模块更新 (CoreMotion.framework)')
  if (syncIOSFeaturePlistPhase()) console.log('✅ iOS feature.plist 覆盖脚本已加入 config/base.yml')
  console.log(`✅ iOS Pod 模式 (依赖来自 uniapp.podspec: ${subspecs.join(', ')})`)
  subspecWarnings.forEach((warning) => console.log(chalk.yellow(warning)))
}

function updateIOSBundleId(ymlName, bundleId) {
  let ymlFile = path.join($G.appDir, 'config', ymlName)
  if (!fs.existsSync(ymlFile)) {
    console.log(chalk.red(`找不到 ${ymlName}，无法写入包名`))
    process.exit(1)
  }
  let content = fs.readFileSync(ymlFile, 'utf8')
  const re = /^(\s*PRODUCT_BUNDLE_IDENTIFIER:\s*)(.*)$/m
  if (!re.test(content)) {
    console.log(chalk.red(`${ymlName} 中缺少 PRODUCT_BUNDLE_IDENTIFIER，无法写入包名`))
    process.exit(1)
  }

  content = content.replace(re, (match, head) => head + bundleId)
  fs.writeFileSync(ymlFile, content)
}

// target yml 是签名信息的唯一来源; 导出 plist 的 teamID / signingCertificate /
// provisioningProfiles 由这里同步, 用户只需改 yml (method 仍只属于导出阶段)
function readIOSSigningSettings(ymlName) {
  const content = fs.readFileSync(path.join($G.appDir, 'config', ymlName), 'utf8')
  const read = (key) => {
    const match = new RegExp(`^[ \t]*${key}:[ \t]*(.+)$`, 'm').exec(content)
    return match ? parseYamlScalar(match[1]) : ''
  }
  return {
    teamID: read('DEVELOPMENT_TEAM'),
    signingCertificate: read('CODE_SIGN_IDENTITY'),
    profile: read('PROVISIONING_PROFILE_SPECIFIER')
  }
}

// 去引号 / 去行尾注释, 够用即可 (签名信息都是单行标量)
function parseYamlScalar(raw) {
  const value = String(raw).trim()
  const quote = value[0]
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1)
    return end > 0 ? value.slice(1, end) : value.slice(1)
  }
  return value.replace(/[ \t]+#.*$/, '')
}

function updateIOSExportProfile(exportPlistName, bundleId, signing) {
  // sim 没有导出配置
  if (!exportPlistName) return ''
  let plistFile = path.join($G.appDir, 'config', exportPlistName)
  // 缺对应 plist 时由构建阶段报错 (own 已在 resolveIOSExportPlist 里拦过)
  if (!fs.existsSync(plistFile)) return ''

  let content = fs.readFileSync(plistFile, 'utf8')
  const re = /(<key>provisioningProfiles<\/key>[\s\S]*?<key>)([^<]+)(<\/key>\s*<string>)([^<]*)(<\/string>)/
  if (!re.test(content)) {
    console.log(chalk.red(`${exportPlistName} 的 provisioningProfiles 缺少 bundle id 条目，无法写入包名与签名信息`))
    process.exit(1)
  }

  content = content.replace(
    re,
    (match, head, oldBundleId, mid, oldProfile, tail) =>
      head + bundleId + mid + (signing.profile || oldProfile) + tail
  )
  content = replacePlistStringValue(content, 'teamID', signing.teamID)
  content = replacePlistStringValue(content, 'signingCertificate', signing.signingCertificate)
  fs.writeFileSync(plistFile, content)

  const method = /<key>method<\/key>\s*<string>([^<]*)<\/string>/.exec(content)
  return method ? method[1] : ''
}

// 键存在才覆盖; 缺键说明模板被改过, 保留原样
function replacePlistStringValue(content, key, value) {
  if (!value) return content
  const re = new RegExp(`(<key>${escapeRe(key)}</key>\\s*<string>)[\\s\\S]*?(</string>)`)
  return content.replace(re, (match, head, tail) => head + escapePlistValue(value) + tail)
}

function escapePlistValue(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// manifest 的 app-plus.distribute.ios.privacyDescription 里是 Info.plist 原生的权限键名,
// 云端打包由 DCloud 写入, 本地打包需要自己同步: 已存在的键覆盖, 模板里没有的键插到根 dict 末尾
function updateIOSPrivacyDescription(plistFile) {
  const privacy = $G.manifest['app-plus']?.distribute?.ios?.privacyDescription
  if (!privacy) return

  let content = fs.readFileSync(plistFile, 'utf8')
  let updated = 0
  Object.keys(privacy).forEach((key) => {
    const value = escapePlistValue(privacy[key])
    const re = new RegExp(`(<key>${escapeRe(key)}</key>\\n\\s*<string>)([\\s\\S]*?)(</string>)`)
    if (re.test(content)) {
      content = content.replace(re, (match, head, oldValue, tail) => head + value + tail)
    } else {
      const index = content.lastIndexOf('</dict>')
      content = content.slice(0, index) + `\t<key>${key}</key>\n\t<string>${value}</string>\n` + content.slice(index)
    }
    updated++
  })

  fs.writeFileSync(plistFile, content)
  console.log(`✅ updateIOSPrivacyDescription (${updated} 项)`)
}

// 数组或逗号分隔字符串 -> 去空的字符串数组 (ios urltypes / urlschemewhitelist, android schemes 共用)
function toValueList(value) {
  if (!value) return []
  const list = Array.isArray(value) ? value : String(value).split(',')
  return list.map((item) => String(item).trim()).filter(Boolean)
}

// 找到 fromIndex 之后那个 <array> 的 </array> 位置, 处理嵌套
function findArrayEnd(content, fromIndex) {
  const start = content.indexOf('<array>', fromIndex)
  if (start === -1) return -1
  const re = /<\/?array>/g
  re.lastIndex = start
  let depth = 0
  let match
  while ((match = re.exec(content))) {
    depth += match[0] === '</array>' ? -1 : 1
    if (depth === 0) return match.index
  }
  return -1
}

// 替换 fromIndex 之后第一个 <array>…</array> 的内容, 沿用原有缩进
function replacePlistArray(content, fromIndex, items) {
  const start = content.indexOf('<array>', fromIndex)
  const end = start === -1 ? -1 : findArrayEnd(content, start)
  if (start === -1 || end === -1) return null
  const inner = content.slice(start + '<array>'.length, end)
  const first = inner.indexOf('<string>')
  const itemIndent = first === -1 ? '\t\t\t\t' : (/[ \t]*$/.exec(inner.slice(0, first))[0] || '\t\t\t\t')
  const lastLine = inner.slice(inner.lastIndexOf('\n') + 1)
  const closeIndent = /^[ \t]*$/.test(lastLine) ? lastLine : '\t\t\t'
  const body = items.map((item) => `${itemIndent}<string>${escapePlistValue(item)}</string>`).join('\n')
  return content.slice(0, start) + `<array>\n${body}\n${closeIndent}</array>` + content.slice(end + '</array>'.length)
}

function urlTypeDict(urlName, schemes) {
  const body = schemes.map((item) => `\t\t\t\t<string>${escapePlistValue(item)}</string>`).join('\n')
  return `\t\t<dict>\n\t\t\t<key>CFBundleTypeRole</key>\n\t\t\t<string>Editor</string>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>${urlName}</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n${body}\n\t\t\t</array>\n\t\t</dict>\n`
}

// 修改 CFBundleURLTypes 里 CFBundleURLName 为 urlName 那条的 schemes; 模板里没有就追加一条
function upsertUrlType(content, urlName, schemes) {
  const markerIndex = content.indexOf(`<string>${urlName}</string>`)
  if (markerIndex !== -1) return replacePlistArray(content, markerIndex, schemes) || content

  const typesIndex = content.indexOf('<key>CFBundleURLTypes</key>')
  if (typesIndex !== -1) {
    const start = content.indexOf('<array>', typesIndex)
    const end = findArrayEnd(content, typesIndex)
    if (start === -1 || end === -1) return content
    const inner = content.slice(start + '<array>'.length, end)
    const closer = inner.slice(inner.lastIndexOf('\n') + 1)
    const closeIndent = /^[ \t]*$/.test(closer) ? closer : ''
    const head = closeIndent ? inner.slice(0, inner.length - closer.length) : `${inner}\n`
    const itemMatch = head.match(/\n([ \t]*)<dict>/)
    const dict = urlTypeDict(urlName, schemes).replace(/^\t\t/, itemMatch ? itemMatch[1] : '\t\t')
    return content.slice(0, start + '<array>'.length) + head + dict + closeIndent + content.slice(end)
  }

  const rootEnd = content.lastIndexOf('</dict>')
  if (rootEnd === -1) return content
  return content.slice(0, rootEnd) + `\t<key>CFBundleURLTypes</key>\n\t<array>\n${urlTypeDict(urlName, schemes)}\t</array>\n` + content.slice(rootEnd)
}

function upsertPlistString(content, key, value) {
  const re = new RegExp(`(<key>${escapeRe(key)}</key>\\n\\s*<string>)([\\s\\S]*?)(</string>)`)
  if (re.test(content)) {
    return content.replace(re, (match, head, oldValue, tail) => head + escapePlistValue(value) + tail)
  }
  const index = content.lastIndexOf('</dict>')
  if (index === -1) return content
  return content.slice(0, index) + `\t<key>${key}</key>\n\t<string>${escapePlistValue(value)}</string>\n` + content.slice(index)
}

// manifest 标准字段: ios.urltypes -> CFBundleURLName=scheme 的 schemes,
// ios.urlschemewhitelist -> LSApplicationQueriesSchemes,
// google client id -> GIDClientID 原值 + google_url 用倒序。
// client id 由 resolveIOSConfig 按构建类型解析 (正式包用标准字段, 测试包可用 uapp.ios.test.googleClientId)
function updateIOSUrlSchemes(plistFile, googleClientId, googleSource) {
  const ios = $G.manifest['app-plus']?.distribute?.ios
  const urltypes = toValueList(ios?.urltypes)
  const urlSchemeWhitelist = toValueList(ios?.urlschemewhitelist)
  if (!urltypes.length && !urlSchemeWhitelist.length && !googleClientId) return

  let content = fs.readFileSync(plistFile, 'utf8')
  if (urltypes.length) content = upsertUrlType(content, 'scheme', urltypes)
  if (googleClientId) {
    content = upsertUrlType(content, 'google_url', [googleClientId.split('.').reverse().join('.')])
    content = upsertPlistString(content, 'GIDClientID', googleClientId)
  }
  if (urlSchemeWhitelist.length) {
    const queriesIndex = content.indexOf('<key>LSApplicationQueriesSchemes</key>')
    if (queriesIndex !== -1) {
      content = replacePlistArray(content, queriesIndex, urlSchemeWhitelist) || content
    } else {
      const index = content.lastIndexOf('</dict>')
      const body = urlSchemeWhitelist.map((item) => `\t\t<string>${escapePlistValue(item)}</string>`).join('\n')
      content = content.slice(0, index) + `\t<key>LSApplicationQueriesSchemes</key>\n\t<array>\n${body}\n\t</array>\n` + content.slice(index)
    }
  }

  fs.writeFileSync(plistFile, content)
  console.log(`✅ updateIOSUrlSchemes (scheme: ${urltypes.length}, queries: ${urlSchemeWhitelist.length}, google: ${googleClientId ? googleSource : 'no'})`)
}

// manifest 根节点的 locale / fallbackLocale 决定 iOS 的本地化列表, 只认 manifest,
// 不扫描 locale/ 目录 (目录里残留的语种文件会让 App Store 语言列表与 manifest 不一致)。
// 不写 CFBundleLocalizations 时 iOS 只认 CFBundleDevelopmentRegion, uni.getSystemInfo 的
// language 永远是开发语言, 应用内多语言不会跟随系统.
function getIOSLocalizationLanguages() {
  const languages = []
  const push = (value) => {
    const item = String(value || '').trim()
    if (item && !languages.includes(item)) languages.push(item)
  }

  push($G.manifest.locale)
  push($G.manifest.fallbackLocale)

  return languages
}

function updateIOSLocalizations(plistFile) {
  const languages = getIOSLocalizationLanguages()
  if (!languages.length) return

  let content = fs.readFileSync(plistFile, 'utf8')
  const key = 'CFBundleLocalizations'
  const keyIndex = content.indexOf(`<key>${key}</key>`)
  const items = languages.map((item) => `\t\t<string>${escapePlistValue(item)}</string>`).join('\n')
  const array = `<array>\n${items}\n\t</array>`

  if (keyIndex === -1) {
    const rootEnd = content.lastIndexOf('</dict>')
    if (rootEnd === -1) return
    content = content.slice(0, rootEnd)
      + `\t<key>${key}</key>\n\t${array}\n`
      + content.slice(rootEnd)
  } else {
    const token = /<array\s*\/>|<array>/.exec(content.slice(keyIndex))
    if (!token) return
    const arrayStart = keyIndex + token.index
    const selfClosing = token[0] !== '<array>'
    const arrayEnd = selfClosing ? arrayStart + token[0].length : findArrayEnd(content, arrayStart)
    if (arrayEnd === -1) return
    content = content.slice(0, arrayStart)
      + array
      + content.slice(selfClosing ? arrayEnd : arrayEnd + '</array>'.length)
  }

  // 兜底语言跟随 fallbackLocale, 保证它始终是 CFBundleLocalizations 里的一种
  const developmentRegion = String($G.manifest.fallbackLocale || '').trim()
  if (developmentRegion) {
    content = upsertPlistString(content, 'CFBundleDevelopmentRegion', developmentRegion)
  }

  fs.writeFileSync(plistFile, content)
  console.log(`✅ updateIOSLocalizations (${languages.join(', ')}${developmentRegion ? `, 兜底: ${developmentRegion}` : ''})`)
}

// manifest 的 app-plus.screenOrientation -> UISupportedInterfaceOrientations (+ ~ipad)
// uni-app 用 portrait-primary/portrait-secondary/landscape-primary/landscape-secondary 描述方向
const IOS_SCREEN_ORIENTATIONS = {
  'portrait-primary': 'UIInterfaceOrientationPortrait',
  'portrait-secondary': 'UIInterfaceOrientationPortraitUpsideDown',
  'landscape-primary': 'UIInterfaceOrientationLandscapeLeft',
  'landscape-secondary': 'UIInterfaceOrientationLandscapeRight'
}

function getIOSSupportedOrientations() {
  const value = $G.manifest['app-plus']?.screenOrientation
  const list = Array.isArray(value) ? value : String(value || '').split(',')
  const orientations = []

  list.forEach((item) => {
    const orientation = IOS_SCREEN_ORIENTATIONS[String(item).trim()]
    if (orientation && !orientations.includes(orientation)) orientations.push(orientation)
  })

  return orientations
}

function updateIOSScreenOrientation(plistFile) {
  const orientations = getIOSSupportedOrientations()
  if (!orientations.length) return

  let content = fs.readFileSync(plistFile, 'utf8')
  let updated = 0
  ;['UISupportedInterfaceOrientations', 'UISupportedInterfaceOrientations~ipad'].forEach((key) => {
    const keyIndex = content.indexOf(`<key>${key}</key>`)
    if (keyIndex === -1) return
    const next = replacePlistArray(content, keyIndex, orientations)
    if (!next) return
    content = next
    updated++
  })
  if (!updated) return

  fs.writeFileSync(plistFile, content)
  const names = orientations.map((item) => item.replace('UIInterfaceOrientation', '')).join(', ')
  console.log(`✅ updateIOSScreenOrientation (${names})`)
}

// ---- 原生插件 ----

// <webAppDir>/nativeplugins/<插件标识>/package.json 里的 _dp_nativeplugin.ios
function getIOSNativePlugins() {
  const nativePlugins = $G.manifest['app-plus']?.nativePlugins || {}
  const plugins = []

  Object.keys(nativePlugins).forEach((id) => {
    const dir = path.join($G.webAppDir, 'nativeplugins', id)
    const packageFile = path.join(dir, 'package.json')
    if (!fs.existsSync(packageFile)) {
      console.log(chalk.yellow(`未找到原生插件 ${id}（${packageFile}），跳过 iOS 插件配置同步`))
      return
    }

    let ios = null
    try {
      ios = JSON.parse(fs.readFileSync(packageFile, 'utf8'))._dp_nativeplugin?.ios
    } catch (error) {
      console.log(chalk.yellow(`原生插件 ${id} 的 package.json 解析失败：${error.message}`))
      return
    }
    if (!ios) {
      console.log(chalk.yellow(`原生插件 ${id} 没有 iOS 平台配置，跳过`))
      return
    }

    plugins.push({ id, dir, ios, parameters: nativePlugins[id] || {} })
  })

  return plugins
}

function plistValueXml(value, pad) {
  if (Array.isArray(value)) {
    const items = value.map((item) => `${pad}\t` + plistValueXml(item, `${pad}\t`)).join('\n')
    return `<array>\n${items}\n${pad}</array>`
  }
  if (value && typeof value === 'object') {
    const items = Object.keys(value).map((key) => buildPlistEntry([key], value[key], `${pad}\t`)).join('\n')
    return `<dict>\n${items}\n${pad}</dict>`
  }
  if (value === undefined || value === null) return '<string></string>'
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>'
  if (typeof value === 'number') return Number.isInteger(value) ? `<integer>${value}</integer>` : `<real>${value}</real>`
  return `<string>${escapePlistValue(value)}</string>`
}

function buildPlistEntry(keyPath, value, pad) {
  const [key, ...rest] = keyPath
  if (rest.length) return `${pad}<key>${key}</key>\n${pad}<dict>\n${buildPlistEntry(rest, value, `${pad}\t`)}\n${pad}</dict>`
  return `${pad}<key>${key}</key>\n${pad}${plistValueXml(value, pad)}`
}

// dict 内部第一行子元素的缩进，用作新增子元素的缩进
function detectPlistPad(dictInner, fallback) {
  const match = /\n([ \t]*)\S/.exec(dictInner)
  return match ? match[1] : fallback
}

// 返回 content 中 start 处 XML 元素的结束位置（含闭合标签）；自闭合标签如 <true/> 直接返回
function findElementEnd(content, start) {
  const match = /^<([A-Za-z][\w-]*)\s*(\/?)>/.exec(content.slice(start))
  if (!match) return null

  const [tag, selfClosing] = match.slice(1)
  if (selfClosing) return { end: start + match[0].length, tag }

  const re = new RegExp(`</?${tag}\\s*>`, 'g')
  re.lastIndex = start
  let depth = 0
  let item
  while ((item = re.exec(content))) {
    depth += item[0][1] === '/' ? -1 : 1
    if (depth === 0) return { end: item.index + item[0].length, tag }
  }
  return null
}

// 在 dict 内部文本里设置 keyPath 指向的值，已存在的键沿用原缩进
function setPlistInDict(dictInner, keyPath, value, pad) {
  const [key, ...rest] = keyPath
  const keyToken = `<key>${key}</key>`
  const keyIndex = dictInner.indexOf(keyToken)
  if (keyIndex === -1) {
    const tail = /\n([ \t]*)$/.exec(dictInner)
    const closingIndent = tail ? tail[1] : ''
    const body = tail ? dictInner.slice(0, tail.index) : dictInner
    return `${body}\n${buildPlistEntry(keyPath, value, pad)}\n${closingIndent}`
  }

  let cursor = keyIndex + keyToken.length
  while (cursor < dictInner.length && /\s/.test(dictInner[cursor])) cursor += 1
  const element = findElementEnd(dictInner, cursor)
  if (!element) return dictInner

  if (rest.length) {
    if (element.tag !== 'dict') return dictInner
    const innerStart = cursor + '<dict>'.length
    const inner = dictInner.slice(innerStart, element.end - '</dict>'.length)
    const nextInner = setPlistInDict(inner, rest, value, detectPlistPad(inner, `${pad}\t`))
    return dictInner.slice(0, innerStart) + nextInner + dictInner.slice(element.end - '</dict>'.length)
  }

  // 连同已有缩进一起替换，避免缩进叠加
  const existingPad = /([ \t]*)$/.exec(dictInner.slice(0, keyIndex))
  const entryPad = existingPad ? existingPad[1] : pad
  const replaceStart = keyIndex - entryPad.length
  return dictInner.slice(0, replaceStart) + buildPlistEntry(keyPath, value, entryPad) + dictInner.slice(element.end)
}

function updatePlistRoot(content, entries) {
  const start = content.indexOf('<dict>')
  if (start === -1) return null

  const element = findElementEnd(content, start)
  if (!element) return null

  const innerStart = start + '<dict>'.length
  let inner = content.slice(innerStart, element.end - '</dict>'.length)
  entries.forEach(([keyPath, value]) => {
    inner = setPlistInDict(inner, keyPath, value, detectPlistPad(inner, '\t'))
  })

  return content.slice(0, innerStart) + inner + content.slice(element.end - '</dict>'.length)
}

// 嵌套 object 展开成 [[keyPath], value]，避免整块覆盖已有的 dict
function collectPlistEntries(value, prefix = []) {
  const entries = []
  Object.keys(value).forEach((key) => {
    const child = value[key]
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      entries.push(...collectPlistEntries(child, [...prefix, key]))
    } else {
      entries.push([[...prefix, key], child])
    }
  })
  return entries
}

// 插件参数定义: 优先 package.json 的 _dp_nativeplugin.ios.parameters,
// package.json 没声明时用 manifest 里 HBuilderX 记录的 __plugin_info__.parameters
function getIOSPluginParameterDefinitions(ios, parameters) {
  const definitions = { ...(ios.parameters || {}) }
  const info = parameters?.__plugin_info__
  if (!info?.parameters || (info.platforms && !/iOS/i.test(info.platforms))) return definitions

  Object.keys(info.parameters).forEach((name) => {
    if (!definitions[name] && info.parameters[name]?.key) definitions[name] = info.parameters[name]
  })
  return definitions
}

// 参数值解析: 优先用 manifest 里填的值, 没填则用定义里的 value 模板 (可含 ${参数名} 占位)
function resolveIOSPluginParameterValue(definitions, name, parameters) {
  const definition = definitions[name] || {}
  const template = definition.value === undefined || definition.value === null ? '' : String(definition.value)
  const rawValue = parameters[name]
  const hasRawValue = rawValue !== undefined && rawValue !== null && rawValue !== ''
  const token = '${' + name + '}'

  if (template.includes(token)) return template.split(token).join(hasRawValue ? String(rawValue) : '')
  // 没模板时保留原始类型 (boolean/number 由 plistValueXml 写成 <true/> / <integer>)
  return hasRawValue ? rawValue : template
}

function getIOSNativePluginPlistEntries(plugins) {
  const entries = []
  plugins.forEach(({ ios, parameters }) => {
    // plists 优先级高于 capabilities.plists
    const plists = { ...(ios.capabilities?.plists || {}), ...(ios.plists || {}) }
    entries.push(...collectPlistEntries(plists))

    const definitions = getIOSPluginParameterDefinitions(ios, parameters)
    Object.keys(definitions).forEach((name) => {
      const definition = definitions[name] || {}
      if (!definition.key) return

      const formatted = resolveIOSPluginParameterValue(definitions, name, parameters)
      // 参数没填时不写占位键, 避免把空字符串塞进 Info.plist (由 warnEmptyIOSPluginParameters 提示)
      if (!String(formatted).trim()) return

      entries.push([definition.key.split(':'), formatted])
    })
  })
  return entries
}

function warnMissingIOSPluginPrivacies(content, plugins) {
  const missing = []
  plugins.forEach(({ id, ios }) => {
    ;(ios.privacies || []).forEach((key) => {
      if (!content.includes(`<key>${key}</key>`)) missing.push(`${id}: ${key}`)
    })
  })
  if (missing.length) {
    console.log(chalk.yellow(`原生插件需要的隐私描述未配置，请在 app-plus.distribute.ios.privacyDescription 补齐：${missing.join(', ')}`))
  }
}

function toIOSProjectPath(target) {
  return path.relative($G.appDir, target).split(path.sep).join('/')
}

// 插件 frameworks / resources 转换成 xcodegen 的 targetTemplates.uAppBase 配置
function buildIOSNativePluginYml(plugins) {
  const groups = new Map()
  const warnings = []
  const groupOf = (name) => {
    if (!groups.has(name)) groups.set(name, { name, dependencies: [], sources: [] })
    return groups.get(name)
  }
  const baseYml = path.join($G.appDir, 'config/base.yml')
  const seenDependencies = new Set()
  const seenSources = new Set()

  // base.yml 里已有的系统库 / 静态库不能重复写，xcodegen 校验到重复依赖会丢掉其他 framework 依赖
  if (fs.existsSync(baseYml)) {
    const baseContent = fs.readFileSync(baseYml, 'utf8')
    for (const match of baseContent.matchAll(/^\s*-\s*(?:sdk|framework):\s*([^\s#]+)/gm)) {
      seenDependencies.add(match[1])
    }
  }

  plugins.forEach(({ id, dir, ios }) => {
    const group = groupOf(id)
    const iosDir = path.join(dir, 'ios')
    // 头文件壳 framework (符号打进了包内其他 fat 静态库) 链接必然 not found, 跳过只留警告
    const skipNoBinary = (name) => {
      warnings.push(`插件 ${id} 的 ${name} 只有头文件没有二进制, 已跳过链接 (符号应由包内其他库提供; 若运行时缺符号请重新拷贝该 framework)`)
    }
    const embedFrameworks = new Set(ios.embedFrameworks || [])
    const frameworks = [...(ios.frameworks || [])]

    // 插件 ios 根目录下的静态库，云打包同样会自动加入 target
    if (fs.existsSync(iosDir)) {
      fs.readdirSync(iosDir).forEach((file) => {
        if (/\.(a|framework|xcframework)$/.test(file) && !frameworks.includes(file)) {
          if (/\.(framework|xcframework)$/.test(file) && !frameworkHasBinary(path.join(iosDir, file))) {
            skipNoBinary(file)
            return
          }
          frameworks.push(file)
        }
      })
    }

    // 插件升级时 package.json 里的 .xcframework 可能已换成 .framework (或反之),
    // 以磁盘上实际存在的为准, 避免生成一条指向不存在路径的依赖让 xcodebuild 直接失败
    const resolveFramework = (name) => {
      if (fs.existsSync(path.join(iosDir, name))) return name
      const swapped = name.endsWith('.xcframework')
        ? name.replace(/\.xcframework$/, '.framework')
        : name.endsWith('.framework') ? name.replace(/\.framework$/, '.xcframework') : ''
      return swapped && fs.existsSync(path.join(iosDir, swapped)) ? swapped : name
    }

    frameworks.map(resolveFramework).forEach((resolved, index) => {
      const name = frameworks[index]
      const target = path.join(iosDir, resolved)
      const exists = fs.existsSync(target)
      // 没有对应文件、名字又是纯系统框架名 (AdSupport.framework / libz.tbd) -> 交给 SDK 链接
      if (!exists && (/\.(tbd|dylib)$/.test(name) || (!name.includes('/') && name.endsWith('.framework')))) {
        if (seenDependencies.has(name)) return
        seenDependencies.add(name)
        group.dependencies.push(`- sdk: ${name}`)
        return
      }
      // .xcframework 只能来自插件目录, 找不到就是插件文件不完整
      if (!exists) {
        warnings.push(`插件 ${id} 声明的 ${resolved} 在 ios/ 下不存在, 已跳过`)
        return
      }
      // 目录在、二进制不在 (头文件壳): 插件常把符号打进 fat 静态库再放同系列 framework 的头文件壳,
      // 链接空壳必然 not found, 跳过只留警告
      if (!frameworkHasBinary(target)) {
        skipNoBinary(resolved)
        return
      }

      const projectPath = toIOSProjectPath(target)
      if (seenDependencies.has(projectPath)) return
      seenDependencies.add(projectPath)

      const embed = exists && (embedFrameworks.has(resolved) || embedFrameworks.has(name)) && /\.(framework|xcframework)$/.test(resolved)
      group.dependencies.push(`- framework: ${projectPath}`, `  embed: ${embed}`, `  codeSign: ${embed}`)
    })

    ;[...(ios.resources || []), ...(ios.assets || [])].forEach((resource) => {
      const target = path.join(iosDir, resource)
      const line = `- path: ${toIOSProjectPath(target)}`
      if (seenSources.has(line)) return
      seenSources.add(line)

      group.sources.push(line)
      if (fs.existsSync(target) && fs.statSync(target).isDirectory() && !/\.\w+$/.test(resource)) {
        group.sources.push('  type: folder')
      }
      group.sources.push('  buildPhase: resources')
    })
  })

  return { groups: [...groups.values()], warnings }
}

// framework / xcframework 目录存在时, 二进制是否也真的在 (只拷了 Headers 的残包会让链接阶段才报错)
function frameworkHasBinary(target) {
  const name = path.basename(target)
  try {
    if (name.endsWith('.xcframework')) {
      // xcframework 顶层只有 Info.plist 和平台切片目录, 二进制在切片内的 .framework/.a/.dylib
      return fs.readdirSync(target).some((entry) => {
        if (entry === 'Info.plist' || !fs.statSync(path.join(target, entry)).isDirectory()) return false
        return fs.readdirSync(path.join(target, entry)).some((inner) => /\.(framework|a|dylib)$/.test(inner))
      })
    }
    if (name.endsWith('.framework')) {
      return fs.existsSync(path.join(target, name.slice(0, -'.framework'.length)))
    }
  } catch (e) {
    return false
  }
  return true
}

// 模块依赖与原生插件依赖按模块名合并，组内按依赖路径 / sdk 名去重
function mergeIOSYml(...parts) {
  const groups = new Map()
  const seenDependencies = new Set()
  const seenSources = new Set()

  const groupLines = (lines) => {
    const result = []
    lines.forEach((line) => {
      if (/^ {2}/.test(line)) {
        if (result.length) result[result.length - 1].push(line)
      } else {
        result.push([line])
      }
    })
    return result
  }

  parts.forEach(({ groups: partGroups = [] }) => {
    partGroups.forEach(({ name, dependencies = [], sources = [] }) => {
      if (!groups.has(name)) groups.set(name, { name, dependencies: [], sources: [] })
      const group = groups.get(name)

      groupLines(dependencies).forEach((item) => {
        const key = item[0].replace(/^- (?:sdk|framework): /, '')
        if (seenDependencies.has(key)) return
        seenDependencies.add(key)
        group.dependencies.push(...item)
      })

      groupLines(sources).forEach((item) => {
        const key = item[0].replace(/^- path: /, '')
        if (seenSources.has(key)) return
        seenSources.add(key)
        group.sources.push(...item)
      })
    })
  })

  return { groups: [...groups.values()] }
}

// uAppBase 已被手写内容占用时，按库文件名去重追加缺失的依赖/资源，保留原有内容；返回 null 表示无法解析
const uappMarkStart = (name) => `# ${name}-start (自动生成, 勿手改)`
const uappMarkEnd = (name) => `# ${name}-end`
const UAPP_MARK_START = /^#\s*(.+?)-start\s*\(自动生成, 勿手改\)\s*$/
const UAPP_MARK_END = /^#\s*(.+?)-end\s*$/
// 用户手写的原生插件块（如 `# sn-adjust1原生插件-start`），uapp 不新建块，只把缺的条目补进去
const PLUGIN_MARK_START = /^#\s*(.+?)原生插件-start\s*$/
const PLUGIN_MARK_END = /^#\s*(.+?)原生插件-end\s*$/

function mergeIntoUAppBase(content, groups) {
  let text = content
  let added = 0
  // 插件手写块里的库如果已经不在磁盘上（插件换版本/拆包后旧库被删），必须清掉：
  // xcodegen 仍会把它写进 target 的 Frameworks 阶段，链接时报 framework 'X' not found
  const pruned = new Set()
  const staleHandFramework = (item) => {
    const match = /^\s*- framework:\s*(\S+)\s*$/.exec(item.lines[0])
    if (!match) return null
    const target = match[1]
    if (path.isAbsolute(target) || target.includes('$(')) return null
    return fs.existsSync(path.resolve($G.appDir, target)) ? null : target
  }

  const keyOf = (line) => {
    const match = /^\s*- (?:sdk|framework|path): (.+?)\s*$/.exec(line)
    return match ? match[1].split('/').pop() : null
  }

  const groupLines = (lines) => {
    const result = []
    lines.forEach((line) => {
      if (/^ {2}/.test(line)) {
        if (result.length) result[result.length - 1].push(line)
      } else {
        result.push([line])
      }
    })
    return result
  }

  const apply = (sectionName, pick) => {
    if (text === null) return
    const lines = text.split('\n')
    const headerIndex = lines.findIndex((line) => /^ {4}uAppBase:\s*$/.test(line))
    if (headerIndex === -1) {
      text = null
      return
    }

    let blockEnd = lines.length
    for (let i = headerIndex + 1; i < lines.length; i++) {
      if (/^ {0,4}\S/.test(lines[i])) {
        blockEnd = i
        break
      }
    }

    const sectionIndex = lines.findIndex(
      (line, i) => i > headerIndex && i < blockEnd && new RegExp(`^ {8}${sectionName}:\\s*$`).test(line)
    )

    let listEnd = sectionIndex + 1
    if (sectionIndex !== -1) {
      while (listEnd < blockEnd && !/^ {8}\S/.test(lines[listEnd])) listEnd++
      while (listEnd > sectionIndex + 1 && lines[listEnd - 1].trim() === '') listEnd--
    }

    // 解析现有条目：条目/注释各自独立，同时标记哪些在 uapp 生成的标记块里（下次整块重写）
    const items = []
    let inMark = false
    let inHand = null
    let current = null
    if (sectionIndex !== -1) {
      for (let i = sectionIndex + 1; i < listEnd; i++) {
        const line = lines[i]
        const trimmed = line.trim()
        if (trimmed === '') {
          current = null
          continue
        }
        if (trimmed.startsWith('#')) {
          const startMatch = UAPP_MARK_START.exec(trimmed)
          if (startMatch) {
            inMark = true
            items.push({ kind: 'mark', lines: [line] })
            current = null
            continue
          }
          const pluginStart = PLUGIN_MARK_START.exec(trimmed)
          if (pluginStart) {
            inHand = pluginStart[1]
            items.push({ kind: 'handStart', handName: inHand, lines: [line] })
            current = null
            continue
          }
          const endMatch = UAPP_MARK_END.exec(trimmed)
          if (endMatch && inMark) {
            inMark = false
            items.push({ kind: 'mark', lines: [line] })
            current = null
            continue
          }
          const pluginEnd = PLUGIN_MARK_END.exec(trimmed)
          if (pluginEnd && inHand) {
            items.push({ kind: 'handEnd', handName: inHand, lines: [line] })
            inHand = null
            current = null
            continue
          }
          items.push({ kind: 'comment', lines: [line], inMark: Boolean(inMark) })
          current = null
          continue
        }
        if (/^\s+- /.test(line)) {
          current = { kind: 'entry', lines: [line], inMark: Boolean(inMark), inHand: Boolean(inHand) }
          items.push(current)
        } else if (current && /^\s{2,}\S/.test(line)) {
          current.lines.push(line)
        } else {
          current = null
        }
      }
    }

    // 块外条目与用户手写注释一律保留；旧 uapp 标记块里的条目丢弃后重写；
    // 手写插件块里磁盘上已不存在的库清掉（插件不再使用的库不该继续留在配置里）
    const kept = items.filter((item) => {
      if (item.kind === 'mark' || item.inMark) return false
      if (item.kind === 'entry' && item.inHand) {
        const stale = staleHandFramework(item)
        if (stale) {
          pruned.add(stale)
          return false
        }
      }
      return true
    })

    // 块外已有的依赖（用户手写或别的工具生成）优先保留，uapp 不再重复写入
    const outsideKeys = new Set(
      kept
        .filter((item) => item.kind === 'entry')
        .map((item) => keyOf(item.lines[0]))
        .filter(Boolean)
    )

    // 本次要写入的条目：按模块分组，跨组按 key 去重（先出现的模块持有该依赖）
    const freshGroups = []
    const seenFresh = new Set()
    groups.forEach(({ name, dependencies = [], sources = [] }) => {
      const list = pick({ dependencies, sources })
      if (!list || !list.length) return
      const keptItems = []
      groupLines(list).forEach((item) => {
        const key = keyOf(item[0])
        if (key) {
          if (outsideKeys.has(key)) return
          if (seenFresh.has(key)) return
          seenFresh.add(key)
        }
        keptItems.push(item)
      })
      if (keptItems.length) freshGroups.push({ name, items: keptItems })
    })

    const oldMarkedKeys = new Set(
      items.filter((item) => item.kind === 'entry' && item.inMark).map((item) => keyOf(item.lines[0])).filter(Boolean)
    )
    freshGroups.forEach((group) => {
      group.items.forEach((item) => {
        const key = keyOf(item[0])
        if (!key || !oldMarkedKeys.has(key)) added++
      })
    })

    const keptLines = []
    // 手写插件块优先：同名模块的条目补进该块 -end 前，不再新建 uapp 块
    const handNames = new Set(items.filter((item) => item.kind === 'handStart').map((item) => item.handName))
    const handAdds = new Map()
    const uappGroups = []
    freshGroups.forEach((group) => {
      if (handNames.has(group.name)) {
        handAdds.set(
          group.name,
          group.items.flatMap((item) => item.map((line) => `            ${line}`))
        )
      } else {
        uappGroups.push(group)
      }
    })

    kept.forEach((item) => {
      if (item.kind === 'handEnd') {
        const adds = handAdds.get(item.handName)
        if (adds && adds.length) {
          keptLines.push(...adds)
          handAdds.delete(item.handName)
        }
      }
      keptLines.push(...item.lines)
    })

    const markLines = uappGroups.flatMap((group) => [
      `            ${uappMarkStart(group.name)}`,
      ...group.items.flatMap((item) => item.map((line) => `            ${line}`)),
      `            ${uappMarkEnd(group.name)}`
    ])

    if (sectionIndex === -1) {
      if (!markLines.length) return
      let insertAt = blockEnd
      while (insertAt > headerIndex + 1 && lines[insertAt - 1].trim() === '') insertAt--
      lines.splice(insertAt, 0, `        ${sectionName}:`, ...markLines)
      text = lines.join('\n')
      return
    }

    if (!keptLines.length && !markLines.length) {
      lines.splice(sectionIndex, listEnd - sectionIndex)
      text = lines.join('\n')
      return
    }

    lines.splice(sectionIndex + 1, listEnd - sectionIndex - 1, ...keptLines, ...markLines)
    text = lines.join('\n')
  }

  apply('dependencies', ({ dependencies }) => dependencies)
  apply('sources', ({ sources }) => sources)
  return text === null ? null : { content: text, added, pruned: [...pruned] }
}

// 模块/插件全部关掉后 uAppBase 会剩一个空 map 头，还原成 uAppBase: {}（xcodegen 不接受 null）
function collapseEmptyUAppBase(content) {
  const lines = content.split('\n')
  const idx = lines.findIndex((line) => /^ {4}uAppBase:\s*$/.test(line))
  if (idx === -1) return content
  let end = idx + 1
  while (end < lines.length && !/^ {0,4}\S/.test(lines[end])) end++
  const hasChild = lines.slice(idx + 1, end).some((line) => /^ {8}\S/.test(line))
  if (hasChild) return content
  lines.splice(idx, end - idx, '    uAppBase: {}')
  return lines.join('\n')
}

function updateIOSCustomYml({ groups }) {
  const customFile = path.join($G.appDir, 'config/custom.yml')
  if (!fs.existsSync(customFile)) return

  let content = fs.readFileSync(customFile, 'utf8')
  const markerStart = '        # >>> uapp nativeplugins (自动生成, 勿手改)'
  const markerEnd = '        # <<< uapp nativeplugins'

  const renderGroups = (pick) => {
    const blocks = groups
      .filter((group) => (pick(group) || []).length)
      .map(
        (group) =>
          `            ${uappMarkStart(group.name)}\n${pick(group)
            .map((line) => `            ${line}`)
            .join('\n')}\n            ${uappMarkEnd(group.name)}`
      )
    return blocks.length ? blocks.join('\n') : null
  }

  const dependenciesBlock = renderGroups((group) => group.dependencies)
  const sourcesBlock = renderGroups((group) => group.sources)
  const sections = []
  if (dependenciesBlock) sections.push(`        dependencies:\n${dependenciesBlock}`)
  if (sourcesBlock) sections.push(`        sources:\n${sourcesBlock}`)

  const generated = sections.length ? `    uAppBase:\n${markerStart}\n${sections.join('\n')}\n${markerEnd}` : '    uAppBase: {}'
  const startMarkerIndex = content.indexOf(markerStart)

  if (startMarkerIndex !== -1) {
    const endMarkerIndex = content.indexOf(markerEnd, startMarkerIndex)
    const headerIndex = content.lastIndexOf('    uAppBase:', startMarkerIndex)
    if (endMarkerIndex === -1 || headerIndex === -1) {
      console.log(chalk.yellow('config/custom.yml 的模块/原生插件标记块不完整，已跳过写入'))
      return
    }
    content = content.slice(0, headerIndex) + generated + content.slice(endMarkerIndex + markerEnd.length)
  } else {
    if (/^ {4}uAppBase:\s*\{\}\s*$/m.test(content)) {
      content = content.replace(/^ {4}uAppBase:\s*\{\}\s*$/m, '    uAppBase:')
    }
    const merged = mergeIntoUAppBase(content, groups)
    if (merged === null) {
      console.log(chalk.yellow('config/custom.yml 的 targetTemplates.uAppBase 已被自定义，未写入模块/原生插件依赖'))
      return
    }
    if (merged.pruned.length) {
      console.log(
        chalk.yellow(`已移除插件里已不存在的库（留着会链接失败 framework not found）: ${merged.pruned.join(', ')}`)
      )
    }
    if (merged.added) console.log(`✅ 已合并 ${merged.added} 条模块/原生插件依赖到 config/custom.yml`)
    content = collapseEmptyUAppBase(merged.content)
  }

  fs.writeFileSync(customFile, content.endsWith('\n') ? content : `${content}\n`)
}

function warnEmptyIOSPluginParameters(plugins) {
  const empty = []
  plugins.forEach(({ id, ios, parameters }) => {
    const definitions = getIOSPluginParameterDefinitions(ios, parameters)
    Object.keys(definitions).forEach((name) => {
      if (definitions[name]?.key && !String(resolveIOSPluginParameterValue(definitions, name, parameters)).trim()) {
        empty.push(`${id}.${name}`)
      }
    })
  })
  if (empty.length) {
    console.log(chalk.yellow(`原生插件参数为空，已跳过写入 Info.plist（插件可能不会生效）：${empty.join(', ')}`))
  }
}

// dcloud_uniplugins 里一条插件注册 (离线打包靠它把 uni_modules 原生插件挂进运行时)
function unipluginsEntry(ios, pad) {
  const inner = `${pad}\t`
  const lines = [`${pad}<dict>`]
  if (ios.hooksClass) {
    lines.push(`${inner}<key>hooksClass</key>`, `${inner}<string>${escapePlistValue(ios.hooksClass)}</string>`)
  }

  const modules = Array.isArray(ios.plugins) ? ios.plugins : []
  lines.push(`${inner}<key>plugins</key>`, `${inner}<array>`)
  modules.forEach((item) => {
    const modulePad = `${inner}\t\t`
    lines.push(`${inner}\t<dict>`)
    ;['type', 'name', 'class'].forEach((key) => {
      if (item[key] === undefined || item[key] === null) return
      lines.push(`${modulePad}<key>${key}</key>`, `${modulePad}<string>${escapePlistValue(item[key])}</string>`)
    })
    lines.push(`${inner}\t</dict>`)
  })
  lines.push(`${inner}</array>`, `${pad}</dict>`)
  return lines.join('\n')
}

// 用 package.json 的 hooksClass / plugins 重写 dcloud_uniplugins:
// 该数组是离线打包的插件注册表, 必须与 manifest 的 nativePlugins 保持一致,
// 所以整段重写, 不在 manifest 里的旧注册会被移除并提示
function updateIOSUniplugins(plistFile, plugins) {
  const nativePlugins = $G.manifest['app-plus']?.nativePlugins || {}
  const manifestType = typeof nativePlugins === 'object' && nativePlugins !== null
  if (!manifestType) return

  let content = fs.readFileSync(plistFile, 'utf8')
  const keyIndex = content.indexOf('<key>dcloud_uniplugins</key>')
  const pad = keyIndex === -1 ? '\t' : (/[ \t]*$/.exec(content.slice(0, keyIndex))[0] || '\t')
  const fresh = plugins.map((plugin) => unipluginsEntry(plugin.ios, `${pad}\t`))
  const label = plugins.map((plugin) => plugin.id).join(', ')

  if (keyIndex === -1) {
    if (!fresh.length) return
    const rootEnd = content.lastIndexOf('</dict>')
    if (rootEnd === -1) return
    const updated = content.slice(0, rootEnd)
      + `${pad}<key>dcloud_uniplugins</key>\n${pad}<array>\n${fresh.join('\n')}\n${pad}</array>\n`
      + content.slice(rootEnd)
    if (updated !== content) {
      fs.writeFileSync(plistFile, updated)
      console.log(`✅ updateIOSUniplugins (${label})`)
    }
    return
  }

  const token = /<array\s*\/>|<array>/.exec(content.slice(keyIndex))
  const arrayStart = token ? keyIndex + token.index : -1
  const selfClosing = token ? token[0] !== '<array>' : false
  const arrayEnd = arrayStart === -1
    ? -1
    : selfClosing
      ? arrayStart + token[0].length
      : findArrayEnd(content, arrayStart)
  if (arrayStart === -1 || arrayEnd === -1) {
    console.log(chalk.yellow('Info.plist 的 dcloud_uniplugins 结构无法解析，已跳过写入'))
    return
  }

  const inner = selfClosing ? '' : content.slice(arrayStart + '<array>'.length, arrayEnd)
  const removed = []
  for (const match of inner.matchAll(/<key>name<\/key>\s*<string>([^<]*)<\/string>/g)) {
    const name = match[1]
    const enabled = plugins.some((plugin) => plugin.ios.plugins?.some((item) => item.name === name))
    if (!enabled) removed.push(name)
  }

  const array = fresh.length
    ? `<array>\n${fresh.join('\n')}\n${pad}</array>`
    : '<array/>'
  const updated = content.slice(0, arrayStart)
    + array
    + content.slice(selfClosing ? arrayEnd : arrayEnd + '</array>'.length)

  if (updated !== content) {
    fs.writeFileSync(plistFile, updated)
    console.log(`✅ updateIOSUniplugins (${label || '已清空'})`)
    if (removed.length) {
      console.log(chalk.yellow(`已移除未在 nativePlugins 中启用的插件注册：${removed.join(', ')}`))
    }
  }
}

// 放在构建流程最后打印，避免被 xcodegen / xcodebuild / gradle 的输出冲掉
function printModuleNotice() {
  const ios = $G.iosModuleNotice
  if (ios) {
    $G.iosModuleNotice = null
    if (ios.warnings.length) ios.warnings.forEach((warning) => console.log(chalk.yellow(warning)))
    if (ios.utsPlugins?.length) console.log(`✅ UTS插件 framework 已写入 config/custom.yml：${ios.utsPlugins.join(', ')}`)
    if (ios.utsSkippedPlugins?.length) console.log(`ℹ️ UTS插件 framework 已配置，未改动：${ios.utsSkippedPlugins.join(', ')}`)
    if (ios.added.length) {
      console.log(`✅ feature.plist 已注册模块：${ios.added.join(', ')}`)
    } else {
      console.log('✅ iOS 模块依赖与 feature.plist 均已是最新')
    }
  }
  const android = $G.androidModuleNotice
  if (android) {
    $G.androidModuleNotice = null
    if (android.warnings.length) android.warnings.forEach((warning) => console.log(chalk.yellow(warning)))
    if (android.featureAdded?.length) console.log(`✅ dcloud_properties.xml 已注册模块 feature：${android.featureAdded.join(', ')}`)
    if (android.pluginAdded?.length || android.pluginRemoved?.length) {
      const parts = []
      if (android.pluginAdded.length) parts.push(`新增 ${android.pluginAdded.join(', ')}`)
      if (android.pluginRemoved.length) parts.push(`移除 ${android.pluginRemoved.join(', ')}`)
      console.log(`✅ Android 原生插件依赖已更新 nativeplugins.libs：${parts.join('；')}`)
    }
    if (android.registryAdded?.length || android.registryRemoved?.length) {
      const parts = []
      if (android.registryAdded.length) parts.push(`新增 ${android.registryAdded.join(', ')}`)
      if (android.registryRemoved.length) parts.push(`移除 ${android.registryRemoved.join(', ')}`)
      console.log(`✅ dcloud_uniplugins.json 已更新插件注册：${parts.join('；')}`)
    }
    if (android.gradleAdded?.length || android.gradleRemoved?.length) {
      const parts = []
      if (android.gradleAdded.length) parts.push(`新增 ${android.gradleAdded.join(', ')}`)
      if (android.gradleRemoved.length) parts.push(`移除 ${android.gradleRemoved.join(', ')}`)
      console.log(`✅ Android 插件依赖/参数已写入 app/build.gradle：${parts.join('；')}`)
    }
    if (android.utsCreated?.length) console.log(`✅ UTS插件模块已生成：${android.utsCreated.join(', ')}`)
    if (android.utsUpdated?.length) console.log(`✅ UTS插件模块已更新：${android.utsUpdated.join(', ')}`)
    if (android.utsAdopted?.length) console.log(`✅ UTS插件模块已收编 (内容与生成结果一致, 之后按账本自动同步)：${android.utsAdopted.join(', ')}`)
    if (android.utsSkipped?.length) console.log(`ℹ️ UTS插件模块未自动更新：${android.utsSkipped.join(', ')}`)
    if (android.utsGradleAdded?.length || android.utsGradleRemoved?.length) {
      const parts = []
      if (android.utsGradleAdded.length) parts.push(`新增 ${android.utsGradleAdded.join(', ')}`)
      if (android.utsGradleRemoved.length) parts.push(`移除 ${android.utsGradleRemoved.join(', ')}`)
      console.log(`✅ UTS插件依赖已写入 app/build.gradle：${parts.join('；')}`)
    }
    if (android.utsSettingsChanged) console.log('✅ settings.gradle 已更新 UTS 插件模块引用')
    if (android.utsClasspathAdded || android.utsJitpackAdded) {
      const parts = []
      if (android.utsClasspathAdded) parts.push('kotlin-gradle-plugin')
      if (android.utsJitpackAdded) parts.push('jitpack 仓库')
      console.log(`✅ 根 build.gradle 已补写：${parts.join('、')}`)
    }
    if (android.added.length || android.removed.length) {
      const parts = []
      if (android.added.length) parts.push(`新增 ${android.added.join(', ')}`)
      if (android.removed.length) parts.push(`移除 ${android.removed.join(', ')}（模块已取消勾选）`)
      console.log(`✅ Android 模块依赖已更新 sdk.libs：${parts.join('；')}`)
    } else if (!android.featureAdded?.length && !android.pluginAdded?.length && !android.registryAdded?.length && !android.gradleAdded?.length && !android.gradleRemoved?.length && !android.utsCreated?.length && !android.utsUpdated?.length && !android.utsAdopted?.length && !android.utsSkipped?.length && !android.utsGradleAdded?.length && !android.utsGradleRemoved?.length && !android.utsSettingsChanged && !android.utsClasspathAdded && !android.utsJitpackAdded) {
      console.log('✅ Android 模块依赖已是最新')
    }
  }
}

// custom.yml / UTS / feature.plist 的生成与具体 Info.plist 无关, AppDev / AppRelease 两个
// plist 各调一次 updateIOSNativePlugins, 共享部分用标记保证一次 prepare 只跑一遍
let iosNativePluginsPrepared = false
function prepareIOSNativePlugins(plugins) {
  if (iosNativePluginsPrepared) return
  iosNativePluginsPrepared = true
  // SDK 依赖交给 uniapp.podspec; 这里只借 buildIOSModuleYml 做隐私描述校验, 不写依赖
  const moduleYml = buildIOSModuleYml({
    modules: $G.manifest['app-plus']?.modules,
    sdkConfigs: $G.manifest['app-plus']?.distribute?.sdkConfigs,
    privacyDescription: $G.manifest['app-plus']?.distribute?.ios?.privacyDescription,
    appDir: $G.appDir,
    // 依赖只有 uniapp.podspec 一条通道: setupIOSPodMode 找不到完整 SDK 会直接退出,
    // 因此这里不会再有手写依赖, 没有 MODULE_DEPS 的模块 (如 FacialRecognitionVerify) 不算缺口
    podMode: true,
  })
  moduleYml.groups = []
  if (moduleYml.errors.length) {
    moduleYml.errors.forEach((error) => console.log(chalk.red(error)))
    console.log(chalk.red('❌ iOS 模块缺少隐私描述，打包中止'))
    process.exit(1)
  }
  // UTS 插件 -> utsplugins/<id>/ 下的 framework -> config/custom.yml
  // Pod 模式也走这条链路: 官方 uniapp_uts_plugins.rb 只认 <id>/utssdk/app-ios 布局, 与 uapp 的导出目录不一致
  const utsYml = buildIOSUtsYml({
    appDir: $G.appDir,
    webAppDir: $G.webAppDir,
  })
  const pluginYml = buildIOSNativePluginYml(plugins)
  updateIOSCustomYml(mergeIOSYml(moduleYml, pluginYml, utsYml))
  const featurePatch = patchFeaturePlist({
    // 源文件只读共享 SDK 里的 pristine 版本; 结果写到工程内, 构建时再覆盖进包
    sourcePlist: path.join($G.appDir, 'SDKs/SDK/Bundles/PandoraApi.bundle/feature.plist'),
    outputPlist: path.join($G.appDir, 'config/feature.plist'),
    modules: $G.manifest['app-plus']?.modules,
    sdkConfigs: $G.manifest['app-plus']?.distribute?.sdkConfigs,
  })
  $G.iosModuleNotice = {
    warnings: [...moduleYml.warnings, ...pluginYml.warnings, ...featurePatch.warnings, ...utsYml.warnings],
    added: featurePatch.added,
    utsPlugins: utsYml.groups.filter((group) => !group.skipped).map((group) => group.name),
    utsSkippedPlugins: utsYml.groups.filter((group) => group.skipped).map((group) => group.name),
  }
  if (plugins.length) {
    warnEmptyIOSPluginParameters(plugins)
    console.log(`✅ updateIOSNativePlugins (${plugins.map((plugin) => plugin.id).join(', ')})`)
  }
}

function updateIOSNativePlugins(plistFile) {
  const plugins = getIOSNativePlugins()
  prepareIOSNativePlugins(plugins)
  updateIOSUniplugins(plistFile, plugins)
  if (!plugins.length) return

  const content = fs.readFileSync(plistFile, 'utf8')
  const entries = getIOSNativePluginPlistEntries(plugins)
  const updated = entries.length ? updatePlistRoot(content, entries) : content
  if (updated === null) {
    console.log(chalk.yellow('Info.plist 结构无法解析，已跳过原生插件配置写入'))
    return
  }

  fs.writeFileSync(plistFile, updated)
  warnMissingIOSPluginPrivacies(updated, plugins)
}

function replaceInfoPlist(plistFile, appkey = $G.manifest.uapp.appkey) {
  let content = fs.readFileSync(plistFile, 'utf8')
  let re = /(<key>dcloud_appkey<\/key>\n.+?<string>)(.*?)(<\/string>)/g
  content = content.replace(re, '$1' + appkey + '$3')

  // replace ios and wexin meanwhile
  // 已知空操作 (暂不处理): 模板 Info.plist 里没有 UniversalLinks / weixin / appSecret 这些键,
  // 下面 4 条替换在现有模板上匹配不到, 等模板补齐 plist 键后再启用
  const weixin = $G.manifest['app-plus']?.distribute?.sdkConfigs?.oauth?.weixin
  if (weixin) {
    re = /(<key>UniversalLinks<\/key>\n.+?<string>)(.*?)(<\/string>)/g
    content = content.replace(re, '$1' + weixin.UniversalLinks + '$3')

    re = /(<key>weixin<\/key>[\s\S]+?appid<\/key>\n.+?<string>)(.*?)(<\/string>)/g
    content = content.replace(re, '$1' + weixin.appid + '$3')

    re = /(<string>weixin<\/string>\n.+?<key>CFBundleURLSchemes<\/key>[\s\S]+?<string>)(.*?)(<\/string>)/g
    content = content.replace(re, '$1' + weixin.appid + '$3')

    re = /(<key>weixin<\/key>[\s\S]+?appSecret<\/key>\n.+<string>)(.*?)(<\/string>)/g
    content = content.replace(re, '$1' + weixin.appsecret + '$3')
  }

  re = /(<key>CFBundleDisplayName<\/key>\n.+?<string>)(.*?)(<\/string>)/g
  if (!re.test(content)) {
    console.error('no CFBundleDisplayName, you should use xcode set Display Name first')
    process.exit(1)
  }

  content = content.replace(re, '$1' + $G.manifest.uapp.name + '$3')
  fs.writeFileSync(plistFile, content)
}

function replaceControlXml(xmlFile) {
  let sdkControlFile = path.join($G.sdkHomeDir, '/ios/SDK/control.xml')
  let innerSDKVersion = '1.0.0'
  if (fs.existsSync(sdkControlFile)) {
    let content = fs.readFileSync(sdkControlFile, 'utf8')
    // SDK 里是 <HBuilder version="...">，工程模板里是小写 <hbuilder version="...">，
    // 老的 /<HBuilder.+version="(.*)"/ 只能匹配前者，模板里的 version 因此从没被改写过
    let match = content.match(/<hbuilder[^>]*\bversion="([^"]*)"/i)
    if (match) innerSDKVersion = match[1] || innerSDKVersion
  }

  let content = fs.readFileSync(xmlFile, 'utf8')
  let re = /(app appid=")(.+?)(")/g
  content = content.replace(re, '$1' + $G.manifest.uapp.appid + '$3')
  content = content.replace(/(<hbuilder[^>]*\bversion=")([^"]*)(")/i, '$1' + innerSDKVersion + '$3')
  // appver 是内置资源版本，跟 manifest.json 的 versionName 保持同步，不再手改
  let appver = normalizeVersionName($G.manifest.uapp.versionName)
  if (appver) {
    content = content.replace(/(\bappver=")([^"]*)(")/g, '$1' + appver + '$3')
  }

  fs.writeFileSync(xmlFile, content)
}

function updateIOSIcons(resDir) {
  const iconResourceDir = getIconResourceDir(resDir)
  let iconFiles = fs.readdirSync(iconResourceDir)
  iconFiles.forEach(function (file) {
    if (!file.endsWith('.png')) return
    // skip android icons
    if (['72x72.png', '96x96.png', '144x144.png', '192x192.png'].includes(file)) return

    const fullPath = path.join(iconResourceDir, file)
    sync(fullPath, path.join($G.appDir, '/Main/Resources/Images.xcassets/AppIcon.appiconset/', file), { delete: true })
  })

  // 不再生成 Main/Resources/logo@2x|3x.png：现行模板走 asset catalog
  // （CFBundleIconName=AppIcon），这两个文件既不在 Resources 构建白名单里、
  // 也不被 Info.plist 引用，属于 4d682cd 遗留的空产物，只会污染工作区。
  console.log('✅ updateIOSIcons')
}

function printManifestInfo() {
  console.log()
  console.log('- appid       : ' + $G.manifest.uapp.appid)
  console.log('- appName     : ' + $G.manifest.uapp.name)
  if ($G.projectType === 'ios') {
    IOS_BUILD_TYPES.forEach((buildType) => {
      const config = resolveIOSConfig(buildType)
      const inherited = []
      if (config.packageFromBase) inherited.push('package')
      if (config.appkeyFromBase) inherited.push('appkey')
      const note = inherited.length > 0 ? ` (${inherited.join(' / ')} 回退 base)` : ''
      console.log(`- ios.${buildType.padEnd(8)}: ${config.package || '(未配置)'} / ${config.appkey || '(未配置)'}${note}`)
    })
  } else {
    console.log('- package     : ' + $G.manifest.uapp.package)
    if ($G.manifest.uapp.appkey) {
      console.log('- appKey      : ' + $G.manifest.uapp.appkey)
    }
  }
  console.log('- versionName : ' + $G.manifest.uapp.versionName)
  console.log('- versionCode : ' + $G.manifest.uapp.versionCode)

  // for uniapp project
  console.log()
  const appkeyKey = $G.projectType === 'ios'
    ? `uapp.ios.${$G.args.argv.remain[2] || 'base'}.appkey`
    : `uapp.${$G.projectType}.appkey`
  console.log(`👇 DCloud 开发者后台配置 dcloud_appkey (${appkeyKey}): `)
  console.log('https://dev.dcloud.net.cn/pages/app/detail/info?tab=package&appid=' + $G.manifest.uapp.appid)
  console.log()
}

// generate jwt token for apple oauth login
async function printJWTToken() {
  console.log('------ JWT Token ------')
  try {
    const configPath = path.join($G.appDir, 'jwt/config.json')
    let config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

    if (!config.team_id) {
      let content = fs.readFileSync(path.join($G.appDir, 'config/custom.yml'), 'utf8')
      let r = content.match(/DEVELOPMENT_TEAM:\s+(.*)/)
      config.team_id = r[1] || ''
    }

    if (!config.team_id) {
      throw '请在 jwt/config.json 中设置 team_id'
    }

    let privateKey = fs.readFileSync(path.join($G.appDir, 'jwt/key.txt'))
    let headers = { kid: config.key_id }
    let timestamp = Math.floor(Date.now() / 1000)
    let claims = {
      iss: config.team_id,
      iat: timestamp,
      exp: timestamp + 86400 * 180,
      aud: 'https://appleid.apple.com',
      sub: config.client_id
    }

    const jwt = await import('jsonwebtoken')
    let token = jwt.default.sign(claims, privateKey, { algorithm: 'ES256', header: headers })
    console.log(token)
  } catch (error) {
    console.log(error.message + '\n')
    console.log('jwt/config.json 内容参考: ')
    console.log(`
{
    "team_id": "3DSM494K6L",
    "client_id": "com.code0xff.uapp.login",
    "key_id": "3C7FMSZC8Z"
}
    `)
  }

  console.log()
  console.log('👉 参考教程: http://help.jwt.code0xff.com')
}

function printAndroidKeyInfo(gradle) {
  let output = execSync(gradle + ' app:signingReport').toString()
  let r
  if (output.indexOf('Invalid keystore format') > 0) {
    r = output.match(/Error: ([\s\S]+?)\n----------/)
    console.log('签名文件错误: ' + r[1])
    console.log('问题可能因为创建 app.keystore 时使用的java版本和当前不一致，可更换java版本后再尝试')
    console.log('\n------ 当前java版本 ------')
    return execSync('java -version', { stdio: 'inherit' })
  }

  r = output.match(/Variant: release[\s\S]+?----------/)
  let md5 = r[0].match(/MD5: (.+)/)[1].replace(/:/g, '')
  let sha1 = r[0].match(/SHA1: (.+)/)[1]
  console.log('👇 应用签名 (MD5), 用于微信开放平台:')
  console.log(md5)
  console.log()
  console.log('👇 Android 证书签名 (SHA1), 用于离线打包 Key:')
  console.log(sha1)

  console.log()
  console.log('----------')
  console.log(r[0])
}

function printHBuilderXDirNotFound() {
  console.log('找不到 HBuilderX 安装路径')
  console.log('配置 HBuilderX 环境命令: ' + chalk.yellow('uapp config set hbx.dir [path/to/HBuilderX]'))
}

function resolveHBuilderXDir(options = {}) {
  const { useInternalDir = true, exitOnMissing = true } = options
  let hbxDir = $G.config['hbx.dir']
  if (!hbxDir || !fs.existsSync(hbxDir)) {
    printHBuilderXDirNotFound()
    process.exitCode = 1
    if (exitOnMissing) process.exit(1)
    return ''
  }

  const internalDir = path.join(hbxDir, 'Contents/HBuilderX')
  if (useInternalDir && process.platform === 'darwin' && fs.existsSync(internalDir)) {
    return internalDir
  }

  return hbxDir
}

function buildWebApp(buildArg) {
  let hbxDir = resolveHBuilderXDir()
  let node = path.join(hbxDir, 'plugins/node/node')
  if (process.platform === 'win32') {
    node = node + '.exe'
  }

  if (!fs.existsSync(node)) {
    node = $G.config.node
  }

  if (!node || !fs.existsSync(node)) {
    console.log('找不到 node 位置: ' + node)
    console.log('配置 node: ' + chalk.yellow('uapp config set node [path/to/node]'))
    process.exit(1)
  }

  let flag = buildArg.startsWith('build') ? 'build' : ''
  let isWeixin = buildArg.endsWith('mp-weixin')

  let vue = 'vue2'
  let spawnArgs = []
  let spawnOpts = { stdio: 'pipe' }
  let buildScript
  const buildName = buildArg.split(':')[1]

  if (Number($G.manifest.vueVersion) === 3) {
    vue = 'vue3'
    buildScript = path.join(hbxDir, 'plugins/uniapp-cli-vite/node_modules/@dcloudio/vite-plugin-uni/bin/uni.js')
    spawnArgs = [buildScript, flag, '-p', buildName]
  } else {
    buildScript = path.join(hbxDir, 'plugins/uniapp-cli/bin/uniapp-cli.js')
    process.env.NODE_PATH = path.join(hbxDir, 'plugins/uniapp-cli/node_modules')
    spawnOpts.cwd = process.env.VUE_CLI_CONTEXT = process.env.UNI_CLI_CONTEXT = path.join(hbxDir, 'plugins/uniapp-cli')
    spawnArgs = [buildScript]
  }

  process.env.UNI_PLATFORM = require(path.join($G.webAppDir, 'package.json'))?.['uni-app']?.['scripts']?.[buildName]?.['env']?.UNI_PLATFORM ?? buildName

  if (!fs.existsSync(buildScript)) {
    console.log(chalk.yellow(`HBuilderX 需要安装插件 => uni-app (${vue}) 编译器`))
    process.exit(1)
  }

  let buildOutDir = getBuildOut()
  process.env.HX_Version = '3.x'
  process.env.HX_APP_ROOT = process.env.APP_ROOT = hbxDir
  process.env.UNI_INPUT_DIR = $G.webAppDir
  process.env.UNI_OUTPUT_DIR = buildOutDir
  process.env.NODE_ENV = flag === 'build' ? 'production' : 'development'

  return new Promise((resolve, reject) => {
    let p = spawn(node, spawnArgs, spawnOpts)
    p.on('error', reject)
    let first = false

    p.stdout.on('data', data => {
      data = data.toString()
      if (data.indexOf('DONE') > -1 && data.indexOf('Build complete') > 0) {
        first = true
        process.stdout.write(chalk.green(data))
      } else {
        process.stdout.write(data)
      }

      if ($G.args.open && isWeixin && first) {
        first = false
        runWeixinCli(['open', '--project', buildOutDir])
      }
    })

    let errOut = ''
    p.stderr.on('data', data => {
      process.stderr.write(chalk.red(data))
      errOut += data.toString()
    })

    p.on('close', code => {
      if (code !== 0 || errOut.indexOf('failed with errors') > -1 || errOut.indexOf('Missing platform') > -1) {
        return reject(Object.assign(new Error('Web 编译失败'), { exitCode: code || 1 }))
      }

      if (['build', 'app'].every(v => $G.args.argv.remain[1].includes(v)) && $G.args.release?.split('.').pop() === 'wgt') {
        let releaseDir = path.join($G.webAppDir, 'unpackage/release')
        fs.mkdirSync(releaseDir, { recursive: true })
        let wgtFile = path.join(releaseDir, path.basename($G.args.release))
        zipDirectory(buildOutDir, wgtFile).then(() => {
          console.log('\n打包成功, wgt 文件路径: ')
          console.log(wgtFile)
          resolve()
        }).catch(reject)
      } else {
        resolve()
      }
    })
  })
}

function getBuildOut() {
  if ($G.args.out) {
    return $G.args.out
  }

  let buildArg = $G.args.argv.remain[1]
  let isDev = buildArg.startsWith('dev:')
  let relativeDir = ''

  if (buildArg.startsWith('build:app')) {
    relativeDir = 'unpackage/resources/' + $G.manifest.uapp.appid + '/www'
  } else if (isDev) {
    relativeDir = 'unpackage/dist/dev/' + buildArg.split(':')[1]
  } else {
    relativeDir = 'unpackage/dist/build/' + buildArg.split(':')[1]
  }

  return path.join($G.webAppDir, relativeDir)
}

function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile()

    function addDir(dir, base) {
      const files = fs.readdirSync(dir)
      for (const file of files) {
        const fullPath = path.join(dir, file)
        const relativePath = path.relative(base, fullPath)
        if (isNativePluginPath(relativePath)) continue
        const stat = fs.statSync(fullPath)

        if (stat.isDirectory()) {
          addDir(fullPath, base)
        } else {
          zipfile.addFile(fullPath, relativePath, { compress: false })
        }
      }
    }

    addDir(sourceDir, sourceDir)
    const output = fs.createWriteStream(outPath)
    zipfile.outputStream.pipe(output).on('close', () => { resolve() }).on('error', reject)
    zipfile.end()
  })
}

const uniAppTestTargets = {
  'web-chrome': { platform: 'h5-chrome', browser: 'chromium', info: 'web chrome' },
  'web-firefox': { platform: 'h5-firefox', browser: 'firefox', info: 'web firefox' },
  'web-safari': { platform: 'h5-safari', browser: 'webkit', info: 'web safari' },
  'mp-weixin': { platform: 'mp-weixin' },
  'app-android': { platform: 'android', os: 'android', uniPlatform: 'app-plus' },
  'app-ios-simulator': { platform: 'ios', os: 'ios', uniPlatform: 'app-plus' },
  'app-ios': { platform: 'ios', os: 'ios', uniPlatform: 'app-plus' },
  'app-harmony': { platform: 'harmony', os: 'harmony', uniPlatform: 'app-harmony' }
}

function runUniAppTest(testArg) {
  const testName = testArg.split(':')[1]
  const target = uniAppTestTargets[testName]
  if (!target) {
    process.exitCode = 1
    console.log(`不支持测试平台 ${testName}, 当前支持的平台有: ${Object.keys(uniAppTestTargets).join(', ')}`)
    return
  }

  const options = parseUniAppTestArgs($G.args.argv.original.slice(2))
  if (options.project) {
    $G.webAppDir = path.resolve(options.project)
  }

  return runUniAppJestTest({ ...target, name: testName }, options)
}

function parseUniAppTestArgs(args) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue
    const [key, value] = args[i].slice(2).split(/=(.*)/s)
    if (value !== undefined) {
      options[key] = value
    } else if (args[i + 1] && !args[i + 1].startsWith('--')) {
      options[key] = args[++i]
    } else {
      options[key] = true
    }
  }
  return options
}

function runUniAppJestTest(target, options = {}) {
  const hbx = resolveHBuilderXRuntime()
  const projectPath = path.resolve($G.webAppDir)
  const envFile = path.join(projectPath, 'env.js')
  const deviceId = getUniAppTestDeviceId(options)

  ensureUniAppTestConfig(projectPath, hbx)
  updateUniAppTestDevice(envFile, target, deviceId, hbx)

  const jestConfigSource = getJestConfigSource(projectPath)
  const outputFile = getUniAppTestReportFile(projectPath, target.platform, deviceId)
  const env = {
    HOME: process.env.HOME,
    PATH: ['./node_modules/.bin', process.env.PATH, path.dirname(hbx.node)].filter(Boolean).join(path.delimiter),
    NODE_PATH: [
      hbx.testNodeModules,
      hbx.compilerNodeModules,
      process.env.NODE_PATH,
    ].filter(Boolean).join(path.delimiter),
    NO_COLOR: true,
    UNI_CLI_PATH: hbx.uniCliPath,
    UNI_INPUT_DIR: projectPath,
    UNI_AUTOMATOR_CONFIG: envFile,
    UNI_PLATFORM: target.uniPlatform || (target.platform.startsWith('h5-') ? 'h5' : target.platform),
    HX_Version: hbx.version,
    uniTestProjectName: path.basename(projectPath),
    uniTestPlatformInfo: target.info || target.platform,
    UNI_AUTOMATOR_PORT: options.port || 9520,
    HX_CONFIG_ADB_PATH: $G.config['adb.path'] || '',
    UNIAPPX_KOTLIN_COMPILER_MEMORY: $G.config['uniappx.kotlin.compiler.memory'] || 2048,
    NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072',
    UNI_NODE_PATH: hbx.node,
    ...loadUniTestCustomEnv(envFile)
  }

  if (target.os) env.UNI_OS_NAME = target.os
  if (target.browser) {
    env.BROWSER = target.browser
  }
  if (deviceId && target.os) env.UNI_AUTOMATOR_DEVICE_ID = deviceId
  if (options.debug) env.DEBUG = 'automator:*'

  const cmd = [
    hbx.jest,
    '-i',
    '--forceExit',
    '--json',
    `--outputFile=${outputFile}`,
    `--env=${hbx.automatorEnv}`,
    `--globalTeardown=${hbx.automatorTeardown}`
  ]
  if (!hasJestConfigOption(jestConfigSource, 'transform')) {
    cmd.push('--transform', JSON.stringify(getDefaultJestTransform(hbx)))
  }
  if (!hasJestConfigOption(jestConfigSource, 'moduleNameMapper')) {
    cmd.push('--moduleNameMapper', JSON.stringify({
      '^~?@/(.*)$': path.join(projectPath, '$1'),
    }))
  }
  if (options.testcaseFile) {
    const testFile = path.join(projectPath, options.testcaseFile)
    if (!fs.existsSync(testFile)) {
      console.log('测试用例文件不存在: ' + testFile)
      process.exit(1)
    }
    cmd.push(options.testcaseFile)
  }

  const p = spawn(hbx.node, cmd, { cwd: projectPath, env, stdio: 'inherit' })
  p.on('close', code => {
    process.exit(code ?? 1)
  })
  p.on('error', error => {
    console.log(error.message)
    process.exit(1)
  })
}

function resolveHBuilderXRuntime() {
  let hbxDir = resolveHBuilderXDir()
  let node = path.join(hbxDir, 'plugins/node/node')

  if (process.platform === 'win32') node += '.exe'
  if (!fs.existsSync(node)) node = $G.config.node

  if (!node || !fs.existsSync(node)) {
    console.log('找不到 node 位置: ' + node)
    console.log('配置 node: ' + chalk.yellow('uapp config set node [path/to/node]'))
    process.exit(1)
  }

  const versionFile = path.join(hbxDir, 'plugins/about/package.json')
  const uniCliPath = path.join(hbxDir, Number($G.manifest.vueVersion) === 3 ? 'plugins/uniapp-cli-vite' : 'plugins/uniapp-cli')
  const testPluginPath = path.join(hbxDir, 'plugins/hbuilderx-for-uniapp-test')
  const testLibPath = path.join(hbxDir, 'plugins/hbuilderx-for-uniapp-test-lib')
  const runtime = {
    dir: hbxDir,
    node,
    version: fs.existsSync(versionFile) ? require(versionFile).version.split('.').slice(0, 2).join('.') : '3.x',
    uniCliPath,
    testPluginPath,
    testLibPath,
    testNodeModules: path.join(testLibPath, 'node_modules'),
    compilerNodeModules: path.join(uniCliPath, 'node_modules'),
    jest: path.join(testLibPath, 'node_modules/jest/bin/jest.js'),
    automatorEnv: path.join(uniCliPath, 'node_modules/@dcloudio/uni-automator/dist/environment.js'),
    automatorTeardown: path.join(uniCliPath, 'node_modules/@dcloudio/uni-automator/dist/teardown.js')
  }

  ensureUniAppTestDependency(runtime.testPluginPath, [
    '未找到 HBuilderX 自动化测试插件 hbuilderx-for-uniapp-test。',
    '请通过 HBuilderX 插件市场安装「uni-app自动化测试」插件。',
    '插件地址: https://ext.dcloud.net.cn/plugin?id=5708'
  ])
  ensureUniAppTestDependency(runtime.testLibPath, [
    '未找到 HBuilderX 自动化测试依赖库 hbuilderx-for-uniapp-test-lib。',
    '该目录由「uni-app自动化测试」插件初始化测试环境时创建。',
    '请在 HBuilderX 中点击菜单【运行 - uni-app自动化测试辅助插件 - 重装测试环境依赖】。'
  ])
  ensureUniAppTestDependency(runtime.jest, '未找到 HBuilderX 内置 Jest，请在 HBuilderX 中点击菜单【运行 - uni-app自动化测试辅助插件 - 重装测试环境依赖】。')
  ensureUniAppTestDependency(runtime.automatorEnv, '未找到 uni-automator environment.js，请确认 uni-app 编译器插件安装完整。')
  ensureUniAppTestDependency(runtime.automatorTeardown, '未找到 uni-automator teardown.js，请确认 uni-app 编译器插件安装完整。')

  return runtime
}

function getJestConfigSource(projectPath) {
  const configFile = path.join(projectPath, 'jest.config.js')
  return fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : ''
}

function hasJestConfigOption(configSource, option) {
  return new RegExp(`\\b${option}\\s*:`).test(configSource)
}

function getDefaultJestTransform(hbx) {
  return {
    '^.+\\.js$': [
      require.resolve('babel-jest', { paths: [hbx.testLibPath] }),
      {
        plugins: [require.resolve('@babel/plugin-transform-modules-commonjs', { paths: [hbx.uniCliPath] })],
      },
    ],
  }
}

function ensureUniAppTestDependency(file, message) {
  if (fs.existsSync(file)) return
  console.log('找不到 HBuilderX 自动化测试依赖: ' + file)
  ;(Array.isArray(message) ? message : [message]).forEach(line => console.log(line))
  process.exit(1)
}

function ensureUniAppTestConfig(projectPath, hbx) {
  for (const file of ['env.js', 'jest.config.js']) {
    const targetFile = path.join(projectPath, file)
    if (fs.existsSync(targetFile)) continue
    const templateFile = path.join(hbx.testPluginPath, 'src/template', file)
    if (!fs.existsSync(templateFile)) {
      console.log('找不到 HBuilderX 自动化测试模板: ' + templateFile)
      process.exit(1)
    }
    sync(templateFile, targetFile, { delete: true })
    console.log(chalk.green('已创建自动化测试配置: ' + targetFile))
  }
}

function getUniAppTestReportFile(projectPath, testPlatform, deviceId) {
  const reportDir = path.join(projectPath, '.hbuilderx/test-report', testPlatform)
  fs.mkdirSync(reportDir, { recursive: true })
  const pad = value => String(value).padStart(2, '0')
  const now = new Date()
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('')
  return path.join(reportDir, `${deviceId ? deviceId + '-' : ''}${timestamp}.json`)
}

function loadUniTestCustomEnv(envFile) {
  try {
    delete require.cache[require.resolve(envFile)]
    const envConfig = require(envFile)
    return _.isPlainObject(envConfig?.UNI_TEST_CUSTOM_ENV) ? envConfig.UNI_TEST_CUSTOM_ENV : {}
  } catch {
    return {}
  }
}

function getUniAppTestDeviceId(options) {
  return options.device_id || options['device-id'] || options.deviceId || ''
}

function updateUniAppTestDevice(envFile, target, deviceId, hbx) {
  const testPlatform = target.platform
  if (!['android', 'ios', 'harmony'].includes(testPlatform)) return
  try {
    delete require.cache[require.resolve(envFile)]
    const envConfig = require(envFile)
    const appPlusPath = ['app-plus']
    if (!_.isPlainObject(_.get(envConfig, appPlusPath))) {
      _.set(envConfig, appPlusPath, {})
    }

    if (deviceId) {
      _.set(envConfig, [...appPlusPath, testPlatform, 'id'], deviceId)
    }
    if (!envConfig['is-custom-runtime']) {
      _.set(envConfig, [...appPlusPath, testPlatform, 'executablePath'], getUniAppTestLauncherPath(hbx.dir, target))
      _.set(envConfig, [...appPlusPath, 'version'], path.join(hbx.dir, 'plugins/launcher/base/version.txt'))
    }

    fs.writeFileSync(envFile, 'module.exports = ' + JSON.stringify(envConfig, null, 4))
  } catch {
    console.log(envFile + ' 测试配置文件, 可能存在语法错误，请检查。')
    process.exit(1)
  }
}

function getUniAppTestLauncherPath(hbxDir, target) {
  const launcherBase = path.join(hbxDir, 'plugins/launcher/base')
  if (target.platform === 'android') return path.join(launcherBase, 'android_base.apk')
  if (target.platform === 'ios') {
    return path.join(launcherBase, target.name === 'app-ios' ? 'iPhone_base.ipa' : 'Pandora_simulator.app')
  }
  return $G.config['harmony.devTools.path'] || ''
}

function runToolCli(cli, args) {
  const result = spawnSync(cli, args, { stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  if (result.error || result.signal || result.status !== 0) {
    process.exitCode = result.status || 1
  }
  return result
}

function runHBuilderXCli(args) {
  const hbxDir = resolveHBuilderXDir({ useInternalDir: false, exitOnMissing: false })
  if (!hbxDir) return

  let cli = 'cli'
  if (process.platform === 'darwin') {
    if (fs.existsSync(path.join(hbxDir, '../MacOS/cli'))) {
      cli = '../MacOS/cli'
    } else {
      cli = 'Contents/MacOS/cli'
    }
  }
  cli = path.join(hbxDir, cli)

  if (process.platform === 'win32') {
    cli = cli + '.exe'
  }

  console.log(cli)
  return runToolCli(cli, args)
}

function runWeixinCli(args) {
  let cli = process.platform === 'darwin' ? 'Contents/MacOS/cli' : 'cli'
  cli = path.join($G.config['wx.dir'], cli)

  if (process.platform === 'win32') {
    cli = cli + '.bat'
  }

  if (!fs.existsSync(($G.config['wx.dir']))) {
    process.exitCode = 1
    console.log('找不到微信安装路径')
    return console.log('配置微信环境命令: ' + chalk.yellow('uapp config set wx.dir [path/to/weixin]'))
  }

  console.log(cli)
  return runToolCli(cli, args)
}

function clone(url, projectName) {
  const spinner = ora()
  spinner.start('正在下载中，请稍后...')
  tiged(url, { cache: true, force: false, verbose: true })
    .on('info', info => {
      spinner.succeed(info.message)
    })
    .clone(projectName)
}

function printHelp() {
  console.log(fs.readFileSync(path.join(__dirname, '../doc/help.txt'), 'utf8'))
}
