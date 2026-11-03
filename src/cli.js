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
  config: {}
}

export default function (inputArgs) {
  checkForUpdates()
  let args = $G.args = nopt(knownOpts, shortHands, inputArgs)

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
    return runHBuilderXCli(args.argv.original.slice(1))
  }

  if (cmd === 'wx') {
    return runWeixinCli(args.argv.original.slice(1))
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
      console.log('3. cd ios && xcodegen generate')
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
  if (cmd === 'info' && (!args.argv.remain[1] || args.argv.remain[1] === 'jwt' || args.argv.remain[1] === 'key')) {
    printManifestInfo()

    if (($G.projectType === 'ios' && !args.argv.remain[1]) || args.argv.remain[1] === 'jwt') {
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
        return
      }

      if ($G.projectType === 'ios') {
        try {
          execSync('xcodegen', { stdio: 'inherit' })
        } catch (e) {
          console.log('请先安装 xcodegen, 可通过 brew install xcodegen 安装, 参考 iOS 配置文档: ')
          console.log('👉 https://gitee.com/uappkit/platform/blob/main/ios/README.md')
          return
        }
        const name = fs.readFileSync(path.join($G.appDir, '/project.yml'), 'utf8').match(/^name:\s*(\S+)/m)[1]
        if (buildType === 'test') {
          // gererate uapp_test.xcarchive
          execSync(
            `xcodebuild -project ${name}.xcodeproj -destination "generic/platform=iOS" -scheme "${name}-test" -archivePath out/${name}_test.xcarchive archive`,
            { stdio: 'inherit' }
          )

          // generate ipa
          execSync(
            `xcodebuild -exportArchive -archivePath out/${name}_test.xcarchive -exportPath out -exportOptionsPlist config/${resolveIOSExportPlist('test')}`,
            { stdio: 'inherit' }
          )

          // 重命名 IPA 文件
          const originalFilePath = path.join($G.appDir, `out/${name}-test.ipa`)
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
            `xcodebuild -project ${name}.xcodeproj -destination "generic/platform=iOS" -scheme "HBuilder" -archivePath out/${name}_debug.xcarchive archive`,
            { stdio: 'inherit' }
          )

          // generate ipa
          execSync(
            `xcodebuild -exportArchive -archivePath out/${name}_debug.xcarchive -exportPath out -exportOptionsPlist config/export_dev.plist`,
            { stdio: 'inherit' }
          )

          const ipaFile = path.join($G.appDir, 'out/HBuilder.ipa')
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
            -project ${name}.xcodeproj \
            -destination "platform=iOS Simulator,name=iPhone 17" \
            -scheme "HBuilder"\
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
            `xcodebuild -project ${name}.xcodeproj -destination "generic/platform=iOS" -scheme "${name}-release" -archivePath out/${name}_release.xcarchive archive`,
            { stdio: 'inherit' }
          )

          // generate ipa
          execSync(
            `xcodebuild -exportArchive -archivePath out/${name}_release.xcarchive -exportPath out -exportOptionsPlist config/export_release.plist`,
            { stdio: 'inherit' }
          )

          // 重命名 IPA 文件
          const originalFilePath = path.join($G.appDir, `out/${name}-release.ipa`)
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

  if (!$G.manifest.appid) {
    console.log(chalk.yellow('manifest.json 中缺少 appid，请打开 HBuilderX 获取'))
  }

  if (!$G.manifest.uapp) {
    console.log(chalk.yellow('manifest.json 中缺少 uapp 节点，请复制并添加如下内容'))
    console.log(`
"uapp": {
  "package": "com.code0xff.uapp",
  "android.appkey": "申请并替换为 android dcloudkey",
  "ios": {
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
    removeSync(path.join(embedAppsDir, $G.manifest.appid))
  } else {
    emptyDirSync(embedAppsDir)
    sync(compiledDir, path.join(embedAppsDir, $G.manifest.appid, 'www'))
    console.log(chalk.green('APP打包所需资源已更新'))
  }
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

// manifest 的 app-plus.distribute.android.permissions / excludePermissions / schemes -> AndroidManifest.xml
// permissions 只增不删 (工程里手工加的权限保留), excludePermissions 用 tools:node="remove" 排除
function updateAndroidManifest() {
  const android = $G.manifest['app-plus']?.distribute?.android
  const permissions = Array.isArray(android?.permissions) ? android.permissions : []
  const excludePermissions = Array.isArray(android?.excludePermissions) ? android.excludePermissions : []
  const schemes = toValueList(android?.schemes)
  if (!permissions.length && !excludePermissions.length && !schemes.length) return

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
  permissions.forEach((entry) => {
    const name = androidPermissionName(entry)
    if (!name || hasPermission(name)) return
    insertPermissionLine(`<uses-permission android:name="${name}" />`)
    addedPermissions++
  })

  let excludedPermissions = 0
  excludePermissions.forEach((entry) => {
    const name = androidPermissionName(entry)
    if (!name) return
    const declaredRe = new RegExp(`<uses-permission[^>]*android:name="${escapeRe(name)}"[^>]*/>`)
    const declared = declaredRe.exec(content)
    if (declared) {
      if (/tools:node="remove"/.test(declared[0])) return
      content = content.replace(declaredRe, `<uses-permission android:name="${name}" tools:node="remove" />`)
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
  console.log(`✅ updateAndroidManifest (permissions: +${addedPermissions}, exclude: ${excludedPermissions}, schemes: +${addedSchemes})`)
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

// uapp.ios.{base|test|sim|release} 的 package/appkey; test/sim 未填的字段回退 base
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

  return {
    package: ownPackage || basePackage,
    appkey: ownAppkey || baseAppkey,
    packageFromBase: !ownPackage && !!basePackage,
    appkeyFromBase: !ownAppkey && !!baseAppkey
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

  updateIOSVersions()

  if (config) {
    const infoPlistFile = path.join($G.appDir, 'Main/Resources/', targetFiles.infoPlist)
    replaceInfoPlist(infoPlistFile)
    updateIOSPrivacyDescription(infoPlistFile)
    updateIOSLocalizations(infoPlistFile)
    updateIOSScreenOrientation(infoPlistFile)
    updateIOSUrlSchemes(infoPlistFile)
    updateIOSNativePlugins(infoPlistFile)
  }

  replaceControlXml(path.join($G.appDir, 'Main/Resources/AppDev/control.xml'))
  replaceControlXml(path.join($G.appDir, 'Main/Resources/AppRelease/control.xml'))

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

  console.log(config ? `✅ updateIOSMetaData (${rawBuildType}: ${config.package})` : '✅ updateIOSMetaData (仅版本/资源)')
}

function updateIOSVersions() {
  let baseYamlFile = path.join($G.appDir, 'config/base.yml')
  let content = fs.readFileSync(baseYamlFile, 'utf8')
  let versionName = normalizeVersionName($G.manifest.uapp.versionName)

  content = content.replace(/(MARKETING_VERSION: )(.*)/g, '$1' + versionName)
  content = content.replace(/(CURRENT_PROJECT_VERSION: )(.*)/g, '$1' + $G.manifest.uapp.versionCode)
  fs.writeFileSync(baseYamlFile, content)
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
// sdkConfigs.oauth.google.clientid -> GIDClientID 原值 + google_url 用倒序
function updateIOSUrlSchemes(plistFile) {
  const ios = $G.manifest['app-plus']?.distribute?.ios
  const urltypes = toValueList(ios?.urltypes)
  const urlSchemeWhitelist = toValueList(ios?.urlschemewhitelist)
  const googleClientId = String($G.manifest['app-plus']?.distribute?.sdkConfigs?.oauth?.google?.clientid || '').trim()
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
  console.log(`✅ updateIOSUrlSchemes (scheme: ${urltypes.length}, queries: ${urlSchemeWhitelist.length}, google: ${googleClientId ? 'yes' : 'no'})`)
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
  const dependencies = []
  const sources = []
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

  plugins.forEach(({ dir, ios }) => {
    const iosDir = path.join(dir, 'ios')
    const embedFrameworks = new Set(ios.embedFrameworks || [])
    const frameworks = [...(ios.frameworks || [])]

    // 插件 ios 根目录下的静态库，云打包同样会自动加入 target
    if (fs.existsSync(iosDir)) {
      fs.readdirSync(iosDir).forEach((file) => {
        if (/\.(a|framework|xcframework)$/.test(file) && !frameworks.includes(file)) frameworks.push(file)
      })
    }

    frameworks.forEach((name) => {
      const target = path.join(iosDir, name)
      const exists = fs.existsSync(target)
      if (!exists && (/\.(tbd|dylib)$/.test(name) || (!name.includes('/') && name.endsWith('.framework')))) {
        if (seenDependencies.has(name)) return
        seenDependencies.add(name)
        dependencies.push(`- sdk: ${name}`)
        return
      }

      const projectPath = toIOSProjectPath(target)
      if (seenDependencies.has(projectPath)) return
      seenDependencies.add(projectPath)

      const embed = exists && embedFrameworks.has(name) && /\.(framework|xcframework)$/.test(name)
      dependencies.push(`- framework: ${projectPath}`, `  embed: ${embed}`, `  codeSign: ${embed}`)
    })

    ;[...(ios.resources || []), ...(ios.assets || [])].forEach((resource) => {
      const target = path.join(iosDir, resource)
      const line = `- path: ${toIOSProjectPath(target)}`
      if (seenSources.has(line)) return
      seenSources.add(line)

      sources.push(line)
      if (fs.existsSync(target) && fs.statSync(target).isDirectory() && !/\.\w+$/.test(resource)) {
        sources.push('  type: folder')
      }
      sources.push('  buildPhase: resources')
    })
  })

  return { dependencies, sources }
}

function updateIOSCustomYml({ dependencies, sources }) {
  const customFile = path.join($G.appDir, 'config/custom.yml')
  if (!fs.existsSync(customFile)) return

  let content = fs.readFileSync(customFile, 'utf8')
  const markerStart = '        # >>> uapp nativeplugins (自动生成, 勿手改)'
  const markerEnd = '        # <<< uapp nativeplugins'

  const blocks = []
  if (dependencies.length) blocks.push(`        dependencies:\n${dependencies.map((line) => `            ${line}`).join('\n')}`)
  if (sources.length) blocks.push(`        sources:\n${sources.map((line) => `            ${line}`).join('\n')}`)

  const generated = blocks.length ? `    uAppBase:\n${markerStart}\n${blocks.join('\n')}\n${markerEnd}` : '    uAppBase: {}'
  const startMarkerIndex = content.indexOf(markerStart)

  if (startMarkerIndex !== -1) {
    const endMarkerIndex = content.indexOf(markerEnd, startMarkerIndex)
    const headerIndex = content.lastIndexOf('    uAppBase:', startMarkerIndex)
    if (endMarkerIndex === -1 || headerIndex === -1) {
      console.log(chalk.yellow('config/custom.yml 的原生插件标记块不完整，已跳过写入'))
      return
    }
    content = content.slice(0, headerIndex) + generated + content.slice(endMarkerIndex + markerEnd.length)
  } else if (/^ {4}uAppBase:\s*\{\}\s*$/m.test(content)) {
    content = content.replace(/^ {4}uAppBase:\s*\{\}\s*$/m, () => generated)
  } else {
    console.log(chalk.yellow('config/custom.yml 的 targetTemplates.uAppBase 已被自定义，未写入原生插件依赖'))
    return
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

function updateIOSNativePlugins(plistFile) {
  const plugins = getIOSNativePlugins()
  updateIOSCustomYml(buildIOSNativePluginYml(plugins))
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
  warnEmptyIOSPluginParameters(plugins)
  warnMissingIOSPluginPrivacies(updated, plugins)
  console.log(`✅ updateIOSNativePlugins (${plugins.map((plugin) => plugin.id).join(', ')})`)
}

function replaceInfoPlist(plistFile) {
  let content = fs.readFileSync(plistFile, 'utf8')
  let re = /(<key>dcloud_appkey<\/key>\n.+?<string>)(.*?)(<\/string>)/g
  content = content.replace(re, '$1' + $G.manifest.uapp.appkey + '$3')

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
    innerSDKVersion = content.match(/<HBuilder.+version="(.*)"/)[1] || innerSDKVersion
  }

  let content = fs.readFileSync(xmlFile, 'utf8')
  let re = /(app appid=")(.+?)(")/g
  content = content.replace(re, '$1' + $G.manifest.appid + '$3')
  content = content.replace(/(<HBuilder.+version=")(.*)(")/, '$1' + innerSDKVersion + '$3')

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
  console.log('- appid       : ' + $G.manifest.appid)
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
  console.log('https://dev.dcloud.net.cn/pages/app/detail/info?tab=package&appid=' + $G.manifest.appid)
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
    relativeDir = 'unpackage/resources/' + $G.manifest.appid + '/www'
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
