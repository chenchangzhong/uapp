import fs from 'fs'
import path from 'path'

/*
 * Android 模块依赖映射
 *
 * 依赖机制：`android/app/sdk.libs` 每行一个文件名（支持通配符），
 * gradle 模板按行从 ~/.uappsdk/android/SDK/libs fileTree include。
 * 因为是逐行按文件名读的，sdk.libs 里不能写注释/标记块。
 *
 * lib.5plus.base-release.aar 已内置（SDK readme）：barcode camera audio(record)
 * gallery accelerometer orientation proximity console device downloader io
 * nativeObj nativeUI navigator runtime storage webview net zip 等，
 * 这些模块无需额外 aar，不出现在下面的映射表里。
 *
 * 依据：
 * - https://nativesupport.dcloud.net.cn/AppDocs/usemodule/androidModuleConfig/
 *   (android_Library / others / geolocation / map / oauth / pay / push / share / speech / statistic / x5)
 * - ~/.uappsdk/android/SDK/libs 实际文件名逐个核对
 * - 各胶水 aar classes.jar 常量池确认第三方依赖归属
 */

// manifest app-plus.modules -> 需要追加到 sdk.libs 的文件（官方文档 + 本机 SDK 实际文件名）
export const MODULE_AARS = {
  Bluetooth: ['Bluetooth-release.aar'],
  Contact: ['contacts-release.aar'],
  Fingerprint: ['fingerprint-release.aar'],
  iBeacon: ['iBeacon-release.aar'],
  Messaging: ['messaging-release.aar'],
  SQLite: ['sqlite-release.aar'],
  VideoPlayer: ['media-release.aar', 'weex_videoplayer-release.aar'],
  // 官方 others.html LivePusher 章节只要求 weex_livepusher-release.aar（media-livepusher 不在文档里）
  LivePusher: ['weex_livepusher-release.aar'],
  'Webview-x5': ['webview-x5-release.aar', 'weex_webview-x5-release.aar'],
  // Camera/Gallery 在 uni-app App 端内置于 lib.5plus.base-release.aar（SDK readme），无需额外 aar
  // （uni-chooseMedia-release.aar 是 uni-app x 的库，本项目面向 uni-app）
}

export const MODULE_SDK_CONFIG = {
  Geolocation: 'geolocation',
  Maps: 'maps',
  OAuth: 'oauth',
  Payment: 'payment',
  Push: 'push',
  Share: 'share',
  Speech: 'speech',
  Statistic: 'statics',
}

// 「离线推送」勾了 Google FCM推送SDK（manifest 写作 push.unipush.fcm）时走官方 push.html「谷歌推送」那套：
// 必须用 aps-unipush-gp-release.aar，且官方明确「不要和上文的 UniPush 混为一谈，即此配置与上文 UniPush 一同配置时会编译冲突」，
// 所以勾了 FCM 就整套替换，不写普通 uniPush 的 aps-unipush-release.aar
export const PUSH_UNIPUSH_FCM_AARS = [
  'aps-release.aar',
  'aps-unipush-gp-release.aar',
  'sdk-for-gj-*.aar',
  'aps-igexin-fcm-release.aar',
  'fcm-*.aar',
]

export const SDK_CONFIG_AARS = {
  geolocation: {
    system: [], // 系统定位在 lib.5plus.base 内
    baidu: ['baidu-libs-release.aar', 'geolocation-baidu-release.aar'],
    amap: ['AMap3DMap_*.aar', 'geolocation-amap-release.aar'],
  },
  maps: {
    baidu: ['baidu-libs-release.aar', 'map-baidu-release.aar'],
    // 高德 vue 页面用 map-amap、nvue 页面用 weex_amap，manifest 无法区分页面类型，两个都写
    amap: ['AMap3DMap_*.aar', 'map-amap-release.aar', 'weex_amap-release.aar'],
    google: ['weex_google-map-release.aar'],
  },
  oauth: {
    weixin: ['oauth-weixin-release.aar'],
    qq: ['oauth-qq-release.aar', 'open_sdk_*.jar'],
    sina: ['oauth-sina-release.aar', 'openDefault-*.aar'],
    google: ['oauth-google-release.aar'],
    facebook: ['oauth-facebook-release.aar'],
    // 官方文档要求 gtc.aar + gysdk-3.0.6.0.aar，本机 SDK 未提供，写入后由缺文件告警提示
    univerify: ['oauth-univerify-release.aar', 'gtc.aar', 'gysdk-*.aar'],
    apple: [], // 仅 iOS
  },
  payment: {
    alipay: ['payment-alipay-release.aar', 'alipaysdk-android-*.aar'],
    weixin: ['payment-weixin-release.aar'],
    paypal: ['payment-paypal-release.aar'],
    stripe: ['payment-stripe-release.aar'],
    google: ['payment-google-release.aar'],
    appleiap: [], // 仅 iOS
  },
  push: {
    unipush: ['aps-release.aar', 'aps-unipush-release.aar'],
    igexin: ['aps-release.aar', 'aps-igexin-release.aar'],
    fcm: ['aps-release.aar', 'aps-fcm-release.aar'],
  },
  share: {
    weixin: ['share-weixin-release.aar'],
    qq: ['share-qq-release.aar', 'open_sdk_*.jar'],
    sina: ['share-sina-release.aar', 'openDefault-*.aar'],
  },
  speech: {
    baidu: ['speech-release.aar', 'speech_baidu-release.aar'],
    ifly: ['speech-release.aar', 'speech_ifly-release.aar'],
  },
  statics: {
    umeng: ['statistic-release.aar', 'statistic-umeng-release.aar', 'umeng-abtest-*.aar', 'utdid4all-*.jar'],
    google: ['statistic-release.aar', 'statistic-google-release.aar'],
  },
}

// dcloud 的 aar 只是胶水层（classes.jar 里只有 io/dcloud 类），
// 第三方 SDK 真身要靠 maven 依赖；上游模板 build.gradle 只内置了 wechat-sdk（微信登录/分享/支付够用）。
// 依赖归属已用胶水 aar 常量池逐一确认。
// match = 在 app/build.gradle 里检索的关键字，已写则不再提示（厂商推送通道在 DCloud 开发者中心配置，
// manifest 里没有勾选信息，因此这里只提示个推必需依赖）
export const SDK_CONFIG_MAVEN = {
  oauth: {
    google: { hint: 'com.google.android.gms:play-services-auth（Google 登录）', match: 'play-services-auth' },
    facebook: { hint: 'com.facebook.android:facebook-login（官方 oauth.html；另需 res/values/strings.xml 配 facebook_app_id 等）', match: 'com.facebook.android' },
  },
  payment: {
    alipay: { hint: 'com.alipay.sdk:alipaysdk-android', match: 'alipay' },
    paypal: { hint: 'PayPal Checkout SDK', match: 'paypal' },
    stripe: { hint: 'com.stripe:stripe-android', match: 'stripe' },
    google: { hint: 'com.google.android.gms:play-services-wallet:18.1.3（Google 支付，官方 pay.html）', match: 'play-services-wallet' },
  },
  push: {
    unipush: { hint: 'com.getui:gtsdk + com.getui:gtc-dcloud（个推 SDK）', match: 'com.getui' },
    igexin: { hint: 'com.getui:gtsdk + com.getui:gtc-dcloud（个推 SDK）', match: 'com.getui' },
    fcm: { hint: 'Firebase 依赖 + google-services.json（官方 push.html「谷歌推送」章节）', match: 'firebase' },
  },
  statics: {
    umeng: { hint: '友盟统计 SDK（umeng 基础包，本机 SDK 未提供）', match: 'umeng' },
    google: { hint: 'Firebase Analytics 依赖 + google-services.json', match: 'firebase' },
  },
  maps: {
    google: { hint: 'com.google.android.gms:play-services-maps', match: 'play-services-maps' },
  },
}

// uniPush 厂商通道（HBuilderX 3.99+ 个推改仓储方式，官方 push.html「gradle配置」章节）：
// unipush 对象下除 version/offline 外的键都算厂商（如 hms:{}），勾了才提示对应 maven 依赖
// 提示前先检索 app/build.gradle，已写（按 match 关键字）就不再提示
export const PUSH_VENDOR_MAVEN = {
  hms: { hint: "implementation 'com.getui.opt:hwp:3.1.1'（华为）+ 'com.huawei.hms:push:6.11.0.300'（华为 HMS Push）", match: 'com.getui.opt:hwp' },
  honor: { hint: "implementation 'com.getui.opt:honor:3.6.0'（荣耀）+ 'com.hihonor.mcs:push:7.0.61.303'（荣耀 MCS Push）", match: 'com.getui.opt:honor' },
  oppo: { hint: "implementation 'com.assist-v3:oppo:3.3.0'（OPPO，另需 gson/commons-codec/annotation 三个辅助依赖）", match: 'com.assist-v3:oppo' },
  vivo: { hint: "implementation 'com.assist-v3:vivo:3.1.1'（vivo）", match: 'com.assist-v3:vivo' },
  xiaomi: { hint: "implementation 'com.getui.opt:xmp:3.3.1'（小米）", match: 'com.getui.opt:xmp' },
  mip: { hint: "implementation 'com.getui.opt:xmp:3.3.1'（小米）", match: 'com.getui.opt:xmp' },
  meizu: { hint: "implementation 'com.getui.opt:mzp:3.2.3'（魅族）", match: 'com.getui.opt:mzp' },
  mzp: { hint: "implementation 'com.getui.opt:mzp:3.2.3'（魅族）", match: 'com.getui.opt:mzp' },
  fcm: { hint: 'Firebase Messaging（com.google.firebase:firebase-messaging）+ google-services 插件', match: 'firebase-messaging' },
}

function matchPattern(pattern, name) {
  if (!pattern.includes('*')) return pattern === name
  const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i')
  return regex.test(name)
}

function globExists(pattern, allFiles) {
  if (!pattern.includes('*')) return allFiles.includes(pattern)
  return allFiles.some((file) => matchPattern(pattern, file))
}

// 各模块要求的 AndroidManifest.xml 权限（官方 others.html 各模块「Androidmainfest.xml文件需要修改的项」章节）
// 没有权限要求的模块（VideoPlayer/Sqlite 等）不在表内
export const ANDROID_MODULE_PERMISSIONS = {
  Camera: ['android.permission.CAMERA'],
  Barcode: ['android.permission.CAMERA', 'android.permission.VIBRATE', 'android.permission.FLASHLIGHT'],
  Bluetooth: ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.BLUETOOTH_ADMIN', 'android.permission.BLUETOOTH'],
  iBeacon: ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.BLUETOOTH_ADMIN', 'android.permission.BLUETOOTH'],
  LivePusher: [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.RECORD_AUDIO',
    'android.permission.MODIFY_AUDIO_SETTINGS',
    'android.permission.BLUETOOTH',
    'android.permission.CAMERA',
    'android.permission.READ_PHONE_STATE',
  ],
  Contact: ['android.permission.GET_ACCOUNTS', 'android.permission.WRITE_CONTACTS', 'android.permission.READ_CONTACTS'],
  Record: ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'],
  Fingerprint: ['android.permission.USE_FINGERPRINT'],
  Messaging: ['android.permission.RECEIVE_SMS', 'android.permission.SEND_SMS', 'android.permission.WRITE_SMS', 'android.permission.READ_SMS'],
}

// 官方 others.html 要求的 uses-feature（Barcode/LivePusher 章节），勾选模块后自动补进 AndroidManifest.xml
export const ANDROID_MODULE_USES_FEATURES = {
  Barcode: ['android.hardware.camera', 'android.hardware.camera.autofocus'],
  LivePusher: ['android.hardware.Camera', 'android.hardware.camera.autofocus'],
}

// 官方 others.html Bluetooth/iBeacon 章节：targetSdkVersion 31 及以上需要追加 BLUETOOTH_SCAN/BLUETOOTH_CONNECT
export const ANDROID_SDK31_PERMISSIONS = ['android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT']

export function resolveAndroidTargetSdk(manifestValue, gradleContent) {
  const fromManifest = parseInt(String(manifestValue ?? ''), 10)
  if (!Number.isNaN(fromManifest)) return fromManifest
  const match = gradleContent && /targetSdkVersion\s+(\d+)/.exec(gradleContent)
  if (match) return parseInt(match[1], 10)
  return null // 无法判断时按 31+ 处理（Android 12+ 没有这两个权限蓝牙扫描会静默失败）
}

// 官方各三方 provider 章节要求的权限（geolocation/map/pay/share/speech/statistic 等），勾选模块+配了对应 provider 才补
const GEOLOCATION_PERMS = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.CHANGE_WIFI_STATE',
  'android.permission.READ_PHONE_STATE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.INTERNET',
  'android.permission.MOUNT_UNMOUNT_FILESYSTEMS',
  'android.permission.READ_LOGS',
  'android.permission.WRITE_SETTINGS',
]
const SPEECH_PERMS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CHANGE_NETWORK_STATE',
  'android.permission.READ_PHONE_STATE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
]
export const SDK_CONFIG_PERMISSIONS = {
  geolocation: {
    system: GEOLOCATION_PERMS,
    baidu: GEOLOCATION_PERMS,
    amap: [...GEOLOCATION_PERMS, 'android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.FOREGROUND_SERVICE'],
  },
  maps: {
    baidu: GEOLOCATION_PERMS,
    amap: GEOLOCATION_PERMS,
    google: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.INTERNET',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.ACCESS_LOCATION_EXTRA_COMMANDS',
    ],
  },
  oauth: {
    weixin: ['android.permission.MODIFY_AUDIO_SETTINGS'],
    qq: ['android.permission.MODIFY_AUDIO_SETTINGS'],
  },
  payment: {
    alipay: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.READ_PHONE_STATE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.ACCESS_COARSE_LOCATION',
    ],
    weixin: ['android.permission.MODIFY_AUDIO_SETTINGS'],
    paypal: ['android.permission.INTERNET'],
  },
  share: {
    sina: ['android.permission.CHANGE_WIFI_STATE', 'android.permission.ACCESS_WIFI_STATE', 'android.permission.ACCESS_NETWORK_STATE'],
    weixin: ['android.permission.MODIFY_AUDIO_SETTINGS'],
    qq: ['android.permission.MODIFY_AUDIO_SETTINGS'],
  },
  speech: { baidu: SPEECH_PERMS, ifly: SPEECH_PERMS },
  statics: {
    umeng: ['android.permission.READ_PHONE_STATE', 'android.permission.ACCESS_WIFI_STATE', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.INTERNET'],
  },
}

export function buildAndroidModuleLibs({ modules, sdkConfigs, sdkLibsDir, gradleContent, manifestContent }) {
  const lines = []
  const warnings = []
  const errors = []
  const seen = new Set()
  // 老模板 build.gradle 是 `new File('sdk.libs').eachLine { implementation files(...) }`，按文件名原样读，通配符不生效；
  // 映射表里的通配符（如 fcm-*.aar）在本机 SDK libs 里能定位到具体文件时就写成具体文件名
  const sdkLibFiles = sdkLibsDir && fs.existsSync(sdkLibsDir) ? fs.readdirSync(sdkLibsDir) : null

  const add = (file, label) => {
    const expanded = sdkLibFiles && file.includes('*') ? sdkLibFiles.filter((name) => matchPattern(file, name)).sort() : []
    for (const name of expanded.length ? expanded : [file]) {
      if (seen.has(name)) continue
      seen.add(name)
      lines.push(name)
    }
  }

  const addModule = (moduleKey, files, label) => {
    files.forEach((file) => add(file, label))
  }

  const checkFiles = (files, label) => {
    if (!sdkLibsDir || !fs.existsSync(sdkLibsDir)) return
    const allFiles = fs.readdirSync(sdkLibsDir)
    const missing = files.filter((file) => !globExists(file, allFiles))
    if (missing.length) {
      warnings.push(
        `Android SDK libs 缺少 ${missing.join('、')}（${label}），请补到 ${sdkLibsDir} 或改用 maven 依赖`
      )
    }
  }

  // 模块
  for (const moduleKey of Object.keys(modules || {})) {
    // 权限校验：官方要求模块勾选后 AndroidManifest 必须声明对应权限（与 iOS 隐私描述同语义，缺失中止打包）
    const perms = ANDROID_MODULE_PERMISSIONS[moduleKey]
    if (perms) {
      // AndroidManifest.xml 不存在时无从校验（updateAndroidManifest 会自动补），跳过而不是误报
      const missing = typeof manifestContent === 'string' ? perms.filter((p) => !manifestContent.includes(`android:name="${p}"`)) : []
      if (missing.length) {
        errors.push(`模块 ${moduleKey} 需要权限 ${missing.join('、')}，uapp 会自动补进 AndroidManifest.xml；仍缺说明 app/src/main/AndroidManifest.xml 不存在或不可写，请手动声明`)
      }
    }
    if (MODULE_AARS[moduleKey]) {
      const label = `模块 ${moduleKey}`
      addModule(moduleKey, MODULE_AARS[moduleKey], label)
      checkFiles(MODULE_AARS[moduleKey], label)
      continue
    }
    const configKey = MODULE_SDK_CONFIG[moduleKey]
    if (configKey) continue
    // 其余（Barcode/Record/Orientation/Proximity/Ad 等）在 lib.5plus.base 内或暂不支持，无需处理
  }

  // 三方 sdkConfigs（manifest 没勾对应模块时，即使 sdkConfigs 里有配置也不写依赖，
  // 比如工程为了拿 WX_APPID 配了 oauth.weixin 但未启用 OAuth 模块）
  for (const moduleKey of Object.keys(MODULE_SDK_CONFIG)) {
    if (!modules || !modules[moduleKey]) continue
    const configKey = MODULE_SDK_CONFIG[moduleKey]
    const config = sdkConfigs?.[configKey]
    if (!config || typeof config !== 'object') continue
    const table = SDK_CONFIG_AARS[configKey]
    for (const provider of Object.keys(config)) {
      const value = config[provider]
      if (value === undefined || value === null || typeof value !== 'object') continue
      const label = `模块 ${moduleKey} (${configKey}.${provider})`
      // uniPush 勾了 FCM 厂商通道时用谷歌推送那套 aar（见 PUSH_UNIPUSH_FCM_AARS），不支持与普通 uniPush 并存
      const unipushFcm = configKey === 'push' && provider === 'unipush' && Boolean(value.fcm)
      const files = unipushFcm ? PUSH_UNIPUSH_FCM_AARS : table?.[provider]
      if (!files) {
        // apple/appleiap 仅 iOS；system 等空映射已列出；真正未知的提示出来
        if (!['apple', 'appleiap'].includes(provider) && !(provider in (table || {}))) {
          warnings.push(`${label} 在 Android 依赖映射表中没有对应配置，请核对官方文档 nativesupport.dcloud.net.cn/AppDocs/usemodule/androidModuleConfig/`)
        }
        continue
      }
      files.forEach((file) => add(file, label))
      checkFiles(files, label)
      // 谷歌推送那套的个推 SDK 已打包在 sdk-for-gj aar 内，官方只要求 google-services 插件 + firebase-messaging（由 fcm 厂商提示给出）
      const maven = unipushFcm ? null : SDK_CONFIG_MAVEN[configKey]?.[provider]
      // app/build.gradle 里已经写了（按关键字检索）就不提示
      if (maven && !(gradleContent && gradleContent.toLowerCase().includes(maven.match.toLowerCase()))) {
        warnings.push(`${label} 还需要第三方依赖：${maven.hint}，请手动添加到 app/build.gradle`)
      }
      // uniPush 厂商通道：unipush 对象下除 version/offline 外的键都算厂商（如 hms:{}），勾了才提示
      // 3.99+ 官方改为仓储方式，不再需要厂商 aar 文件，只提示 maven 依赖
      if (configKey === 'push' && provider === 'unipush') {
        const vendors = Object.keys(value).filter((key) => !['version', 'offline'].includes(key))
        for (const vendor of vendors) {
          const vendorMaven = PUSH_VENDOR_MAVEN[vendor]
          const vendorLabel = `模块 ${moduleKey} 厂商推送 ${vendor}`
          if (!vendorMaven) {
            warnings.push(`${vendorLabel}：未收录的厂商，请按官方 push.html「gradle配置」章节自行添加 maven 依赖`)
            continue
          }
          if (!(gradleContent && gradleContent.toLowerCase().includes(vendorMaven.match.toLowerCase()))) {
            // 谷歌推送（fcm）只需 google-services 插件 + firebase-messaging，个推 SDK 已打进 sdk-for-gj aar，不需要个推 maven 仓
            const repoHint = vendor === 'fcm' ? '' : '（根目录 build.gradle 需加个推 maven 仓 https://mvn.getui.com/nexus/content/repositories/releases）'
            warnings.push(`${vendorLabel} 还需要第三方依赖：${vendorMaven.hint}，请手动添加到 app/build.gradle${repoHint}`)
          }
        }
      }
    }
  }

  return { lines, warnings, errors }
}

/*
 * 按 manifest modules / sdkConfigs 更新 android/app/sdk.libs（无账本）：
 * - 缺失的行追加
 * - 映射表认识、但已不被勾选模块需要的行直接删除（确认无用才删）
 * - 模板基础库 / 用户自己加的行（映射表不认识的）一律保留
 * - 内容无变化时不动文件
 */
export function updateAndroidModuleLibs({ appDir, sdkHomeDir, modules, sdkConfigs }) {
  const libsFile = path.join(appDir, 'app', 'sdk.libs')
  const sdkLibsDir = path.join(sdkHomeDir, 'android', 'SDK', 'libs')

  if (!fs.existsSync(libsFile)) {
    return { warnings: ['未找到 android/app/sdk.libs，跳过 Android 模块依赖写入'], added: [], removed: [], errors: [] }
  }
  // 老版本遗留的账本文件，已废弃，直接清掉
  const ledgerFile = path.join(appDir, 'app', 'sdk.libs.uapp')
  if (fs.existsSync(ledgerFile)) fs.unlinkSync(ledgerFile)

  const { lines: needed, warnings, errors } = buildAndroidModuleLibs({
    modules,
    sdkConfigs,
    sdkLibsDir: fs.existsSync(sdkLibsDir) ? sdkLibsDir : null,
    gradleContent: (() => {
      const gradleFile = path.join(appDir, 'app', 'build.gradle')
      return fs.existsSync(gradleFile) ? fs.readFileSync(gradleFile, 'utf8') : null
    })(),
    manifestContent: (() => {
      const manifestFile = path.join(appDir, 'app', 'src', 'main', 'AndroidManifest.xml')
      return fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile, 'utf8') : null
    })(),
  })
  if (!fs.existsSync(sdkLibsDir)) {
    warnings.push(`未找到 ${sdkLibsDir}，无法检查依赖文件是否齐全；Android 离线 SDK 需从官方下载解压到 ~/.uappsdk/android/SDK（参考 README「先安装 uappsdk」）`)
  }

  // 按原始行处理：空行、行尾换行状态原样保留，只追加缺失行、删除确认无用的行
  const raw = fs.readFileSync(libsFile, 'utf8')
  const endsNL = raw.endsWith('\n')
  const rawLines = raw.split('\n')
  if (endsNL && rawLines[rawLines.length - 1] === '') rawLines.pop()

  // 映射表认识的文件名（模块/三方 aar）：只有这些行才允许自动删除
  const knownPatterns = [
    ...Object.values(MODULE_AARS).flat(),
    ...Object.values(SDK_CONFIG_AARS).flatMap((table) => Object.values(table)).flat(),
    ...PUSH_UNIPUSH_FCM_AARS,
  ]
  const knownSet = new Set(knownPatterns.filter((p) => !p.includes('*')))
  const knownGlobs = knownPatterns.filter((p) => p.includes('*'))
  const isKnown = (name) => knownSet.has(name) || knownGlobs.some((p) => matchPattern(p, name))

  const neededSet = new Set(needed)
  // needed 里的通配符（如 fcm-*.aar）：工程里已写了具体文件（fcm-3.1.2.aar）就算已满足，不把它改写成通配符
  const satisfiesNeeded = (name) => neededSet.has(name) || needed.some((p) => p.includes('*') && matchPattern(p, name))
  const coveredBy = (list, pattern) => list.some((line) => {
    const t = line.trim()
    return Boolean(t) && (t === pattern || (pattern.includes('*') && matchPattern(pattern, t)))
  })
  const removed = []
  const outLines = rawLines.filter((line) => {
    const t = line.trim()
    if (!t) return true
    if (satisfiesNeeded(t)) return true
    // 映射表认识、但已不被任何勾选模块需要 → 确认无用，直接删
    if (isKnown(t)) {
      removed.push(t)
      return false
    }
    // 模板基础库 / 用户自加的行 → 一律保留
    return true
  })
  const outSet = new Set(outLines.map((line) => line.trim()).filter(Boolean))
  const originalSet = new Set(rawLines.map((line) => line.trim()).filter(Boolean))
  const appended = needed.filter((line) => !outSet.has(line) && !coveredBy(rawLines, line))
  const added = needed.filter((line) => !originalSet.has(line) && !coveredBy(rawLines, line))
  const outText = [...outLines, ...appended].join('\n') + (endsNL ? '\n' : '')
  // 内容无变化时不动文件（避免无意义的 mtime/git 抖动）
  if (outText !== raw) fs.writeFileSync(libsFile, outText)

  // 去重告警（同一个文件可能被多个模块引用）
  return { warnings: [...new Set(warnings)], added, removed, errors }
}

/*
 * 模块 → dcloud_properties.xml feature 注册（官方 others.html 各模块「dcloud_properties.xml文件需要修改的项」章节）。
 * 工程模板的 properties.xml 只有 23 个 feature，勾选模块后必须补注册，否则运行时提示「打包时未添加XX模块」。
 * 节点全部从 SDK 自带的 dcloud_properties.xml 提取，缺的才写入工程文件，幂等。
 */
export const MODULE_FEATURES = {
  Camera: ['Camera'],
  VideoPlayer: ['VideoPlayer'],
  Barcode: ['Barcode'],
  Bluetooth: ['Bluetooth'],
  Contact: ['Contacts'],
  Fingerprint: ['Fingerprint'],
  iBeacon: ['iBeacon'],
  LivePusher: ['LivePusher'],
  Messaging: ['Messaging'],
  SQLite: ['Sqlite'],
}
// 三方模块对应 feature（Push/OAuth 工程文件里通常已有，缺了同样补）
export const SDK_CONFIG_FEATURES = {
  geolocation: ['Geolocation'],
  oauth: ['OAuth'],
  maps: ['Maps'],
  payment: ['Payment'],
  push: ['Push'],
  share: ['Share'],
  speech: ['Speech'],
  statics: ['Statistic'],
}

// 官方各三方页要求在 feature 节点下加 <module> 子节点（值固定，SDK 自带文件缺的补进工程文件）
export const SDK_CONFIG_FEATURE_MODULES = {
  oauth: {
    univerify: { feature: 'OAuth', module: 'OAuth-IGETui', value: 'io.dcloud.feature.igetui.GeTuiOAuthService' },
    google: { feature: 'OAuth', module: 'OAuth-Google', value: 'io.dcloud.feature.google.GoogleOAuthService' },
    facebook: { feature: 'OAuth', module: 'OAuth-Facebook', value: 'io.dcloud.feature.facebook.FacebookOAuthService' },
  },
  payment: {
    paypal: { feature: 'Payment', module: 'Payment-Paypal', value: 'io.dcloud.feature.payment.paypal.PaypalPay' },
    stripe: { feature: 'Payment', module: 'Payment-Stripe', value: 'io.dcloud.feature.payment.stripe.StripePay' },
    google: { feature: 'Payment', module: 'Payment-Google', value: 'io.dcloud.feature.payment.google.GooglePay' },
  },
  push: {
    unipush: { feature: 'Push', module: 'unipush', value: 'io.dcloud.feature.unipush.GTPushService' },
    fcm: { feature: 'Push', module: 'fcm', value: 'io.dcloud.feature.fcm.FCMPushService' },
  },
  statics: {
    umeng: { feature: 'Statistic', module: 'Statistic-Umeng', value: 'io.dcloud.feature.statistics.umeng.UmengStatistics' },
    google: { feature: 'Statistic', module: 'Statistic-Google', value: 'io.dcloud.feature.statistics.google.GoogleStatistics' },
  },
}

// 官方要求的 <services> 节点（SDK 里已有同名服务的不重复加）
export const SDK_CONFIG_FEATURE_SERVICES = {
  push: { unipush: '<service name="push" value="io.dcloud.feature.aps.APSFeatureImpl"/>' },
  statics: { umeng: '<service name="Statistic-Umeng" value="io.dcloud.feature.statistics.umeng.StatisticsBootImpl"/>' },
  maps: { baidu: '<service name="Maps" value="io.dcloud.js.map.MapInitImpl"/>' },
}

function esc(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 在 feature 节点内补 <module name=... value=.../> 子节点；自闭合 feature 转成配对形式再插
// 兼容 CRLF/tab/空格（SDK 自带文件是 CRLF+tab，工程模板是 LF+空格）
function ensureFeatureModule(content, { feature, module: moduleName, value }, childUnit = '\t') {
  if (new RegExp(`<module name="${esc(moduleName)}"`).test(content)) return { content, added: false }
  const openRe = new RegExp(`<feature name="${esc(feature)}"[^>]*?(/)?>`)
  const open = openRe.exec(content)
  if (!open) return { content, added: false } // feature 本体缺失已由前面补/告警
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const moduleText = `<module name="${moduleName}" value="${value}"/>`
  const lineStart = content.lastIndexOf('\n', open.index) + 1
  const indent = content.slice(lineStart, open.index)
  if (open[1] === '/') {
    const childIndent = indent + childUnit
    const paired = `${open[0].slice(0, -2)}>${eol}${childIndent}${moduleText}${eol}${indent}</feature>`
    return { content: content.slice(0, open.index) + paired + content.slice(open.index + open[0].length), added: true }
  }
  const closeIdx = content.indexOf('</feature>', open.index)
  if (closeIdx === -1) return { content, added: false }
  const closeLineStart = content.lastIndexOf('\n', closeIdx) + 1
  const closeIndent = content.slice(closeLineStart, closeIdx)
  const childMatch = /(?:\r?\n)([ \t]*)<module\b/.exec(content.slice(open.index, closeIdx))
  const childIndent = childMatch ? childMatch[1] : closeIndent + childUnit
  // </feature> 独占一行时才按行插入；和别的内容同一行（单行写法）就直接插在它前面
  if (closeIndent.trim() !== '') {
    // 单行写法：插在当前行尾，再把闭合标签换到下一行对齐
    return { content: content.slice(0, closeIdx) + `${moduleText}${eol}${indent}${childUnit}` + content.slice(closeIdx), added: true }
  }
  return {
    content: content.slice(0, closeLineStart) + childIndent + moduleText + eol + closeIndent + content.slice(closeIdx),
    added: true,
  }
}

export function patchDcloudProperties({ propsPath, sdkPropsPath, modules, sdkConfigs }) {
  const warnings = []
  const added = []
  if (!fs.existsSync(propsPath)) {
    warnings.push('未找到 android/app/src/main/assets/data/dcloud_properties.xml，跳过模块 feature 注册')
    return { warnings, added }
  }
  if (!fs.existsSync(sdkPropsPath)) {
    warnings.push('未找到 SDK 的 assets/data/dcloud_properties.xml，跳过模块 feature 注册')
    return { warnings, added }
  }
  const needed = new Set()
  Object.keys(modules || {}).forEach((moduleKey) => {
    ;(MODULE_FEATURES[moduleKey] || []).forEach((name) => needed.add(name))
    const configKey = MODULE_SDK_CONFIG[moduleKey]
    if (!configKey) return
    // 官方 map.html：谷歌地图不需要修改 dcloud_properties.xml；只剩谷歌 provider 时不注册 Maps
    if (configKey === 'maps' && !Object.keys(sdkConfigs?.maps || {}).some((p) => p !== 'google')) return
    ;(SDK_CONFIG_FEATURES[configKey] || []).forEach((name) => needed.add(name))
  })
  // needed 为空时不能直接返回：SDK_CONFIG_FEATURE_MODULES 的 module 子节点仍可能要补（如仅勾 OAuth）

  const sdk = fs.readFileSync(sdkPropsPath, 'utf8')
  const props = fs.readFileSync(propsPath, 'utf8')
  // 行尾/缩进沿用目标文件风格（SDK 自带文件 CRLF+tab，工程模板 LF+空格）
  const eol = props.includes('\r\n') ? '\r\n' : '\n'
  const featureMatch = /(?:\r?\n)([ \t]*)<feature\b/.exec(props)
  const nodeIndent = featureMatch ? featureMatch[1] : '    '
  const childUnit = nodeIndent.includes('\t') ? '\t' : '  '
  // 多行 feature 节点从 SDK 拷贝过来时按目标文件风格重排缩进（SDK 用 tab、工程模板用空格）
  const reindentBlock = (block, indent) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    // 首行（<feature>）和闭合标签用 indent，子节点再缩进一层
    return lines
      .map((line, index) => {
        const own = index === 0 || line.startsWith('</') ? indent : indent + childUnit
        return own + line
      })
      .join(eol)
  }
  const closeLine = (text, tag) => {
    const idx = text.indexOf(tag)
    if (idx === -1) return null
    const lineStart = text.lastIndexOf('\n', idx) + 1
    return { idx, indent: text.slice(lineStart, idx) }
  }
  // 自闭合 <feature .../> 优先（防止跨元素吞内容），带 <module> 子元素的整块兜底
  const extract = (name) => {
    let matches = [...sdk.matchAll(new RegExp(`<feature name="${name}"[^>]*\\/>`, 'g'))].map((m) => m[0])
    if (!matches.length) {
      matches = [...sdk.matchAll(new RegExp(`<feature name="${name}"[^>]*>[\\s\\S]*?</feature>`, 'g'))].map((m) => m[0])
    }
    return matches
  }

  const mapsProvider = Object.keys(sdkConfigs?.maps || {}).find((p) => p !== 'google') || ''
  const missing = [...needed].filter((name) => !new RegExp(`<feature name="${name}"[\\s>]`).test(props))
  let out = props
  missing.forEach((name) => {
    let matches = extract(name)
    if (!matches.length) {
      warnings.push(`模块 feature ${name} 在 SDK 的 dcloud_properties.xml 里找不到注册节点，请手动补（官方 others.html）`)
      return
    }
    // SDK 里 Maps 有 amap/baidu 两个注册值，按 sdkConfigs.maps 的 provider 选
    if (name === 'Maps' && matches.length > 1) {
      const amap = matches.find((m) => m.includes('.map.amap.'))
      const baidu = matches.find((m) => !m.includes('.map.amap.'))
      matches = [mapsProvider === 'baidu' ? baidu || matches[0] : amap || matches[0]]
    }
    const close = closeLine(out, '</features>')
    if (!close) {
      warnings.push('dcloud_properties.xml 里找不到 </features>，无法插入 feature 注册')
      return
    }
    const at = close.idx - close.indent.length
    out = out.slice(0, at) + reindentBlock(matches[0], nodeIndent) + eol + out.slice(at)
    added.push(name)
  })

  // 官方要求 feature 节点下加 <module> 子节点 / <services> 加 <service> 节点（如 OAuth-Google、unipush、Statistic-Umeng）
  Object.keys(MODULE_SDK_CONFIG).forEach((moduleKey) => {
    if (!modules || !modules[moduleKey]) return
    const configKey = MODULE_SDK_CONFIG[moduleKey]
    const config = sdkConfigs?.[configKey]
    if (!config) return
    for (const provider of Object.keys(config)) {
      const spec = SDK_CONFIG_FEATURE_MODULES[configKey]?.[provider]
      if (spec) {
        const res = ensureFeatureModule(out, spec, childUnit)
        if (res.added) {
          out = res.content
          added.push(`${spec.feature}.${spec.module}`)
        }
      }
      const service = SDK_CONFIG_FEATURE_SERVICES[configKey]?.[provider]
      const serviceName = service && /<service name="([^"]+)"/.exec(service)[1]
      // 按 service 名判断，避免工程里写成 `... />`（带空格）时重复插入
      if (service && !new RegExp(`<service name="${serviceName}"[\\s/>]`).test(out)) {
        const close = closeLine(out, '</services>')
        if (!close) {
          warnings.push('dcloud_properties.xml 里找不到 </services>，无法插入 service 注册')
        } else {
          // 缩进对齐已有的 <service>，没有就用 feature 的缩进
          const existingService = /(?:\r?\n)([ \t]*)<service\b/.exec(out)
          const serviceIndent = existingService ? existingService[1] : nodeIndent
          const at = close.idx - close.indent.length
          out = out.slice(0, at) + serviceIndent + service + eol + out.slice(at)
          added.push(`service.${serviceName}`)
        }
      }
    }
  })

  if (added.length) fs.writeFileSync(propsPath, out)
  return { warnings, added }
}

// <webAppDir>/nativeplugins/<插件标识>/package.json 是否声明了 Android 平台
function declaresAndroid(pluginDir) {
  const pkgFile = path.join(pluginDir, 'package.json')
  if (!fs.existsSync(pkgFile)) return true
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
    return Boolean(pkg?._dp_nativeplugin?.android)
  } catch {
    return true
  }
}

/*
 * manifest 的 app-plus.nativePlugins -> android/app/nativeplugins.libs
 *
 * gradle 模板读取格式：每行「插件目录名 aar 文件名（不含 .aar）」，
 * 拼成 <工程根>/nativeplugins/<目录名>/android/<aar>.aar。
 * aar 文件名以目录里的实际文件为准（插件改名后目录名和 aar 名往往不一致）。
 */
export function buildAndroidNativePluginLibs({ webAppDir, nativePlugins }) {
  const lines = []
  const warnings = []
  for (const id of Object.keys(nativePlugins || {})) {
    const pluginDir = path.join(webAppDir, 'nativeplugins', id)
    const androidDir = path.join(pluginDir, 'android')
    const aars = fs.existsSync(androidDir)
      ? fs.readdirSync(androidDir).filter((file) => file.endsWith('.aar')).sort()
      : []
    if (!aars.length) {
      // 只支持 iOS 的插件不需要写进 Android 依赖
      if (!declaresAndroid(pluginDir)) continue
      warnings.push(`原生插件 ${id} 声明了 Android 平台，但 nativeplugins/${id}/android 下没有 .aar，已跳过`)
      continue
    }
    for (const aar of aars) lines.push(`${id} ${aar.slice(0, -4)}`)
  }
  return { lines, warnings }
}

export function updateAndroidNativePluginLibs({ appDir, webAppDir, nativePlugins }) {
  const pluginsDir = path.join(webAppDir, 'nativeplugins')
  if (!fs.existsSync(pluginsDir)) return { warnings: [], added: [], removed: [] }

  const libsFile = path.join(appDir, 'app', 'nativeplugins.libs')
  const { lines: needed, warnings } = buildAndroidNativePluginLibs({ webAppDir, nativePlugins })
  if (!fs.existsSync(libsFile) && !needed.length) return { warnings, added: [], removed: [] }

  const raw = fs.existsSync(libsFile) ? fs.readFileSync(libsFile, 'utf8') : ''
  // 该文件不支持注释，逐行即一条插件依赖；manifest 没声明的插件不该进包
  const existing = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const neededSet = new Set(needed)
  const removed = existing.filter((line) => !neededSet.has(line))
  const added = needed.filter((line) => !existing.includes(line))
  const outText = needed.join('\n') + (needed.length ? '\n' : '')
  if (outText !== raw) fs.writeFileSync(libsFile, outText)
  return { warnings, added, removed }
}

// 读插件的 Android 注册信息（_dp_nativeplugin.android 的 hooksClass / plugins）
function readAndroidPluginEntry(pluginDir, id) {
  const packageFile = path.join(pluginDir, 'package.json')
  if (!fs.existsSync(packageFile)) return null
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
  } catch {
    return null
  }
  const android = pkg?._dp_nativeplugin?.android
  if (!android) return null
  const plugins = (Array.isArray(android.plugins) ? android.plugins : [])
    .filter((plugin) => plugin && plugin.class)
    .map((plugin) => ({ type: plugin.type || 'module', name: plugin.name || id, class: plugin.class }))
  if (!plugins.length) return null
  const entry = {}
  if (android.hooksClass) entry.hooksClass = android.hooksClass
  entry.plugins = plugins
  return entry
}

// dcloud_uniplugins.json：离线打包靠它把 nativeplugins 挂进运行时（对应 iOS Info.plist 的同名键）
export function buildAndroidUniplugins({ webAppDir, nativePlugins }) {
  const entries = []
  const warnings = []
  for (const id of Object.keys(nativePlugins || {})) {
    const pluginDir = path.join(webAppDir, 'nativeplugins', id)
    if (!fs.existsSync(pluginDir)) continue
    const entry = readAndroidPluginEntry(pluginDir, id)
    if (entry) {
      entries.push(entry)
      continue
    }
    if (declaresAndroid(pluginDir)) {
      warnings.push(`原生插件 ${id} 声明了 Android 平台，但 package.json 里没有 _dp_nativeplugin.android.plugins，未注册到 dcloud_uniplugins.json`)
    }
  }
  return { entries, warnings }
}

export function updateAndroidUniplugins({ appDir, webAppDir, nativePlugins }) {
  if (!fs.existsSync(path.join(webAppDir, 'nativeplugins'))) return { warnings: [], added: [], removed: [] }
  const file = path.join(appDir, 'app', 'src', 'main', 'assets', 'dcloud_uniplugins.json')
  const { entries, warnings } = buildAndroidUniplugins({ webAppDir, nativePlugins })
  if (!fs.existsSync(file) && !entries.length) return { warnings, added: [], removed: [] }

  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const names = (list) => (list || []).flatMap((entry) => (entry.plugins || []).map((plugin) => plugin.name))
  let previous = []
  try {
    previous = JSON.parse(raw)?.nativePlugins || []
  } catch {
    previous = []
  }
  const previousNames = names(previous)
  const nextNames = names(entries)
  const added = nextNames.filter((name) => !previousNames.includes(name))
  const removed = previousNames.filter((name) => !nextNames.includes(name))
  const outText = JSON.stringify({ nativePlugins: entries }, null, 2) + '\n'
  if (raw !== outText) fs.writeFileSync(file, outText)
  return { warnings, added, removed }
}

// 插件 package.json 的 _dp_nativeplugin.android 全量信息（依赖 + 参数）
function readAndroidPluginMeta(pluginDir) {
  const packageFile = path.join(pluginDir, 'package.json')
  if (!fs.existsSync(packageFile)) return null
  try {
    return JSON.parse(fs.readFileSync(packageFile, 'utf8'))?._dp_nativeplugin?.android || null
  } catch {
    return null
  }
}

// 只认带「(自动生成, 勿手改)」后缀的块, 避免把用户手写的同名注释块当成自己的
const UAPP_GRADLE_BLOCK = /^[ \t]*\/\/ 原生插件(.+?)所需库-开始 \(自动生成, 勿手改\)\r?\n([\s\S]*?)^[ \t]*\/\/ 原生插件\1所需库-结束[ \t]*$/gm
const UAPP_PLACEHOLDER_BLOCK = /^[ \t]*\/\/ 原生插件(.+?)占位符-开始 \(自动生成, 勿手改\)\r?\n([\s\S]*?)^[ \t]*\/\/ 原生插件\1占位符-结束[ \t]*$/gm

// groovy 双引号字符串的转义, 占位符值里出引号时不能直接拼
function escapeGradleString(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// 伞包：声明了伞包但工程里已有其子库时不再重复写（伞包只聚合依赖，本身没有类）
const ARTIFACT_ALIASES = {
  'com.facebook.android:facebook-android-sdk': ['com.facebook.android:facebook-core'],
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 按插件 package.json 算出要写进 build.gradle 的 maven 依赖与 manifestPlaceholders
export function buildAndroidPluginGradle({ webAppDir, nativePlugins, gradleContent }) {
  const blocks = []
  const placeholders = []
  const warnings = []
  const seenCoords = new Set()
  // 先剔除自己之前生成的块, 否则会把自己的产物当成「工程里已有」
  const plain = String(gradleContent || '').replace(UAPP_GRADLE_BLOCK, '').replace(UAPP_PLACEHOLDER_BLOCK, '')

  for (const id of Object.keys(nativePlugins || {})) {
    const pluginDir = path.join(webAppDir, 'nativeplugins', id)
    if (!fs.existsSync(pluginDir)) continue
    const meta = readAndroidPluginMeta(pluginDir)
    if (!meta) continue

    const lines = []
    for (const dep of Array.isArray(meta.dependencies) ? meta.dependencies : []) {
      const parts = String(dep).split(':')
      if (parts.length < 2) continue
      const coord = `${parts[0]}:${parts[1]}`
      // 多个插件声明同一坐标时只写第一个（gradle 里重复声明没有意义）
      if (seenCoords.has(coord)) continue
      // 工程（含 uniapp/UTS/用户手写块）里已经有同一个 group:artifact 就不再写
      if (new RegExp(`${escapeRegExp(coord)}:`).test(plain)) continue
      const aliases = ARTIFACT_ALIASES[coord] || []
      if (aliases.some((alias) => new RegExp(`${escapeRegExp(alias)}:`).test(plain))) continue
      lines.push(`implementation "${dep}"`)
      seenCoords.add(coord)
    }
    if (lines.length) blocks.push({ id, lines })

    const params = nativePlugins[id] || {}
    for (const [name, def] of Object.entries(meta.parameters || {})) {
      const key = def?.key
      if (!key) continue
      const value = params[name]
      if (value === undefined || value === null || value === '') {
        warnings.push(`原生插件 ${id} 的参数 ${name}（${key}）没有配置，未写入 manifestPlaceholders`)
        continue
      }
      placeholders.push({ id, key, value: String(value) })
    }
  }
  return { blocks, placeholders, warnings }
}

// 统计一行里未被字符串/注释包裹的 { 与 } 数量, 用于找 dependencies { } 的收尾行
function braceDelta(line) {
  const stripped = line
    .replace(/\/\/.*$/, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  return (stripped.match(/\{/g) || []).length - (stripped.match(/\}/g) || []).length
}

// build.gradle 里插块/删块, 返回新内容与变更行
export function applyAndroidPluginGradle(content, { blocks, placeholders }) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  let lines = content.split(/\r?\n/)
  const added = []
  const removed = []

  // 1) 清掉旧块（连同块内的行）
  const oldDeps = []
  const oldPlaceholders = []
  const kept = []
  let skipping = null
  for (const line of lines) {
    const start = /^[ \t]*\/\/ 原生插件(.+?)(?:所需库|占位符)-开始 \(自动生成, 勿手改\)[ \t]*$/.exec(line)
    if (start && !skipping) {
      skipping = { id: start[1], kind: line.includes('所需库') ? 'deps' : 'ph' }
      continue
    }
    if (skipping) {
      const end = new RegExp(`^[ \\t]*// 原生插件${escapeRegExp(skipping.id)}${skipping.kind === 'deps' ? '所需库' : '占位符'}-结束[ \\t]*$`).test(line)
      if (end) {
        skipping = null
        continue
      }
      const trimmed = line.trim()
      if (trimmed) (skipping.kind === 'deps' ? oldDeps : oldPlaceholders).push(trimmed)
      continue
    }
    kept.push(line)
  }
  // 标记块没有闭合（用户手改删了 -结束 行）时, 继续写会吞掉块后所有内容, 直接放弃
  if (skipping) {
    return { content, added: [], removed: [], eol, brokenMark: true }
  }
  lines = kept

  // 2) 依赖块追加到 dependencies { } 末尾
  if (blocks.length) {
    const openIdx = lines.findIndex((line) => /^[ \t]*dependencies\s*\{[ \t]*$/.test(line))
    if (openIdx === -1) {
      // 没有 dependencies 块就放弃写入, 避免破坏文件结构
      return { content, added: [], removed: [], eol, depsSkipped: true }
    }
    const baseIndent = /^[ \t]*/.exec(lines[openIdx])[0]
    const itemIndent = `${baseIndent}    `
    let depth = 0
    let closeIdx = -1
    for (let i = openIdx; i < lines.length; i++) {
      depth += braceDelta(lines[i])
      if (depth <= 0) {
        closeIdx = i
        break
      }
    }
    if (closeIdx === -1) return { content, added: [], removed: [], eol, depsSkipped: true }

    const inserted = []
    blocks.forEach((block) => {
      // 块间不加空行: 清块时状态机无法区分「自己加的分隔空行」和「用户的空行」, 会破坏幂等
      inserted.push(`${itemIndent}// 原生插件${block.id}所需库-开始 (自动生成, 勿手改)`)
      block.lines.forEach((line) => inserted.push(`${itemIndent}${line}`))
      inserted.push(`${itemIndent}// 原生插件${block.id}所需库-结束`)
    })
    lines.splice(closeIdx, 0, ...inserted)
  }

  // 3) 占位符插到 manifestPlaceholders = [ ] 的收尾 ] 之前
  if (placeholders.length) {
    const openIdx = lines.findIndex((line) => /^[ \t]*manifestPlaceholders\s*=\s*\[[ \t]*$/.test(line))
    if (openIdx === -1) {
      return { content: lines.join(eol), added, removed, eol, placeholderSkipped: true }
    }
    const closeIdx = lines.findIndex((line, index) => index > openIdx && /^[ \t]*\][ \t]*$/.test(line))
    if (closeIdx === -1) return { content: lines.join(eol), added, removed, eol, placeholderSkipped: true }
    const existingIndent = lines[openIdx + 1] ? /^[ \t]*/.exec(lines[openIdx + 1])[0] : `${/^[ \t]*/.exec(lines[openIdx])[0]}    `
    const groups = []
    placeholders.forEach((item) => {
      const group = groups.find((g) => g.id === item.id)
      if (group) group.items.push(item)
      else groups.push({ id: item.id, items: [item] })
    })
    const inserted = []
    groups.forEach((group) => {
      inserted.push(`${existingIndent}// 原生插件${group.id}占位符-开始 (自动生成, 勿手改)`)
      group.items.forEach((item) => inserted.push(`${existingIndent}"${item.key}": "${escapeGradleString(item.value)}",`))
      inserted.push(`${existingIndent}// 原生插件${group.id}占位符-结束`)
    })
    // 块前一条 map 项若没有逗号会拼成语法错误, 补上
    for (let i = closeIdx - 1; i > openIdx; i--) {
      const trimmed = lines[i].trim()
      if (!trimmed || trimmed.startsWith('//')) continue
      if (!trimmed.endsWith(',')) lines[i] = `${lines[i]},`
      break
    }
    // 末尾项不留逗号, 避免不同 groovy 版本对尾逗号处理不一致
    for (let i = inserted.length - 1; i >= 0; i--) {
      if (/^\s*"[^"]+":\s*".*",$/.test(inserted[i])) {
        inserted[i] = inserted[i].slice(0, -1)
        break
      }
    }
    lines.splice(closeIdx, 0, ...inserted)
  }

  // 只报真正新增/移除的行：自己的块每次都会被重写, 直接比内容
  const newDeps = blocks.flatMap((block) => block.lines.map((line) => line.trim()))
  added.push(...newDeps.filter((line) => !oldDeps.includes(line)))
  removed.push(...oldDeps.filter((line) => !newDeps.includes(line)))
  const newPlaceholders = placeholders.map((item) => `"${item.key}": "${escapeGradleString(item.value)}"`)
  const oldPh = oldPlaceholders.map((line) => line.replace(/,$/, ''))
  added.push(...newPlaceholders.filter((line) => !oldPh.includes(line)))
  removed.push(...oldPh.filter((line) => !newPlaceholders.includes(line)))
  return { content: lines.join(eol), added, removed, eol }
}

// 读工程 build.gradle, 按 manifest 的 nativePlugins 同步插件依赖与占位符
export function updateAndroidPluginGradle({ appDir, webAppDir, nativePlugins }) {
  if (!fs.existsSync(path.join(webAppDir, 'nativeplugins'))) return { warnings: [], added: [], removed: [] }
  const file = path.join(appDir, 'app', 'build.gradle')
  if (!fs.existsSync(file)) return { warnings: [], added: [], removed: [] }

  const raw = fs.readFileSync(file, 'utf8')
  const { blocks, placeholders, warnings } = buildAndroidPluginGradle({ webAppDir, nativePlugins, gradleContent: raw })
  if (!blocks.length && !placeholders.length) {
    // 没有要写的内容时只清掉自己以前写的块
    const result = applyAndroidPluginGradle(raw, { blocks: [], placeholders: [] })
    if (result.brokenMark) {
      warnings.push('build.gradle 里有未闭合的 uapp 标记块（缺少 -结束 行），为避免破坏文件未写入，请检查')
      return { warnings, added: [], removed: [] }
    }
    if (result.content !== raw) fs.writeFileSync(file, result.content)
    return { warnings, added: [], removed: result.removed }
  }

  const result = applyAndroidPluginGradle(raw, { blocks, placeholders })
  if (result.brokenMark) {
    warnings.push('build.gradle 里有未闭合的 uapp 标记块（缺少 -结束 行），为避免破坏文件未写入，请检查')
    return { warnings, added: [], removed: [] }
  }
  if (result.depsSkipped) {
    warnings.push('build.gradle 里没有找到 dependencies { }，插件依赖未写入')
  }
  if (result.placeholderSkipped) {
    warnings.push('build.gradle 里没有找到 manifestPlaceholders = [ ]，插件参数未写入')
  }
  if (result.content !== raw) fs.writeFileSync(file, result.content)
  return { warnings, added: result.added, removed: result.removed }
}
