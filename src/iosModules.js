/**
 * 把 manifest 的 app-plus.modules / app-plus.distribute.sdkConfigs 映射成 iOS 离线打包依赖。
 *
 * 依赖清单来自 DCloud 官方文档：
 * - 基础模块：https://nativesupport.dcloud.net.cn/AppDocs/usemodule/iOSModuleConfig/common.html
 * - 三方模块：同目录 push/share/oauth/map/pay/speech/statistic/geolocation/livepusher/uiwebview.html
 *
 * 官方说明 app-plus.modules 仅云打包生效、本地打包需自行配置，所以这里在打包时补齐。
 * 文档没有给出依赖表的模块（或无法从 sdkConfigs 判定 provider 的）只告警，不猜测。
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

// 仅 Android 的模块，iOS 构建时忽略
const IGNORED_MODULES = new Set(['Webview-x5'])

// 模块启用后必须在 Info.plist 里声明的隐私描述键（manifest 的 app-plus.distribute.ios.privacyDescription）。
// 来自官方各模块文档的「权限描述」列；缺任意一项 iOS 运行时会拒绝访问或审核驳回，所以打包时直接报错。
const MODULE_PERMISSIONS = {
  Barcode: ['NSCameraUsageDescription'],
  Bluetooth: ['NSBluetoothPeripheralUsageDescription', 'NSBluetoothAlwaysUsageDescription'],
  Camera: ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription', 'NSMicrophoneUsageDescription'],
  Contact: ['NSContactsUsageDescription'],
  FaceID: ['NSFaceIDUsageDescription'],
  iBeacon: ['NSBluetoothPeripheralUsageDescription', 'NSBluetoothAlwaysUsageDescription'],
  LivePusher: ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription'],
  Record: ['NSMicrophoneUsageDescription'],
}

// 三方模块按 sdkConfigs 分类的权限要求（各 provider 相同）
const SDK_CONFIG_PERMISSIONS = {
  geolocation: ['NSLocationWhenInUseUsageDescription'],
  maps: ['NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription'],
  speech: ['NSMicrophoneUsageDescription'],
}

// 各平台在 manifest 的 app-plus.distribute.sdkConfigs 里必须填的 iOS 参数。
// 字段名以 https://uniapp.dcloud.net.cn/tutorial/app-manifest.html 的完整示例为准。
// 缺参数时库能链接但运行时会失败，所以只告警不中断。
const SDK_CONFIG_PARAMS = {
  geolocation: { amap: ['appkey_ios'], baidu: ['appkey_ios'] },
  maps: { amap: ['appkey_ios'], baidu: ['appkey_ios'], google: ['APIKey_ios'] },
  oauth: {
    weixin: ['appid'],
    qq: ['appid'],
    sina: ['appkey', 'redirect_uri'],
    google: ['clientid'],
    facebook: ['appid'],
  },
  payment: { weixin: ['appid'], paypal: ['returnURL_ios'], stripe: ['returnURL_ios'] },
  share: { weixin: ['appid'], qq: ['appid'], sina: ['appkey', 'redirect_uri'] },
  speech: { baidu: ['appid', 'apikey', 'secretkey'] },
  statics: { umeng: ['appkey_ios'], google: ['config_ios'] },
}

// PDRCore 的插件注册表是 PandoraApi.bundle/feature.plist：离线 SDK 只带基础模块，
// 业务模块（相机/相册/扫码/地图/支付…）必须在这里注册节点才会被加载，
// 否则 plus.gallery 等对象不存在，运行时报「未打包 XX 模块」。
// 云打包由 DCloud 服务端按 modules 自动补，离线打包需要自己补——节点定义取自
// HBuilderX 标准基座 launcher/base/Pandora_simulator.app/PandoraApi.bundle/feature.plist。
const FEATURE_NODES = {
  Ad: { class: 'DCUniAdFeature', global: true },
  barcode: { class: 'PGBarcode', global: true },
  Bluetooth: { class: 'libBlueTooth' },
  Camera: { class: 'PGCamera', global: true },
  Contacts: { class: 'PGContacts', global: false },
  fingerprint: { class: 'Fingerprint', global: true },
  Gallery: { class: 'PGGallery', global: true },
  Geolocation: { class: 'PGGeolocation', global: false },
  iBeacon: { class: 'PGBeacon', global: false },
  LivePusher: { class: 'PGLivePush', global: true },
  Maps: {
    class: 'PGMap',
    global: true,
    server: { class: 'PGBaiduKeyVerify', identifier: 'com.baidu.keyverify' },
  },
  Messaging: { class: 'PGMessaging', global: true },
  Payment: {
    class: 'PGPlatbyManager',
    extend: { alix: 'PGAlixPay', weixin: 'PGWXPay' },
    global: true,
  },
  Record: { class: 'PGRecord', global: true },
  Share: {
    argument: 'weixin',
    autostart: true,
    class: 'PGShareManager',
    extend: {
      qq: 'PGTencentQQShare',
      sinaweibo: 'PGSinaShare',
      tencentweibo: 'PGQQShare',
      weixin: 'PGWXShare',
    },
    global: true,
  },
  ShortVideo: { class: 'PluginShortVideo', global: false },
  Speech: {
    class: 'PGSpeech',
    extend: { baidu: 'PGBaiduSpeech', ifly: 'PGIFLYSpeech' },
    global: true,
  },
  Statistic: {
    autostart: false,
    class: 'UmengStatistic',
    global: true,
    server: { class: 'UmengStatisticServer', identifier: 'com.umeng.startup' },
  },
  Stream: { class: 'PGStream', global: false },
}

// manifest modules -> feature.plist 节点。Camera 模块包含相册（uni.chooseImage 走 plus.gallery）。
// 离线 SDK 已有的模块（Push/SQLite/VideoPlayer/Orientation）不需要补；FaceID/UIWebview 无独立节点。
const MODULE_FEATURE_KEYS = {
  Barcode: ['barcode'],
  Bluetooth: ['Bluetooth'],
  Camera: ['Camera', 'Gallery'],
  Contact: ['Contacts'],
  Fingerprint: ['fingerprint'],
  Gallery: ['Gallery'],
  Geolocation: ['Geolocation'],
  iBeacon: ['iBeacon'],
  LivePusher: ['LivePusher'],
  Maps: ['Maps'],
  Messaging: ['Messaging'],
  Payment: ['Payment'],
  Record: ['Record'],
  Share: ['Share'],
  Speech: ['Speech'],
  Statistic: ['Statistic'],
}

// sdkConfigs.oauth 的平台 -> feature.plist OAuth->extend 的登记项（apple/google 离线 SDK 已内置）。
// 注意 extend 的 key 不一定等于 manifest 里的 provider 名：sina 在 feature.plist 里登记为 weibo。
const OAUTH_FEATURE_EXTEND = {
  weixin: { key: 'weixin', className: 'PGWXOauth' },
  qq: { key: 'qq', className: 'PGQQOauth' },
  sina: { key: 'weibo', className: 'PGSinaWBOauth' },
  univerify: { key: 'univerify', className: 'PGUniVerify' },
  facebook: { key: 'facebook', className: 'PGFBOauth' },
}

// 与 base.yml 无关的模块依赖；base.yml 已有的项在生成时按路径去重
const MODULE_DEPS = {
  Barcode: {
    libs: ['liblibBarcode.a', 'libDCUniBarcode.a', 'libDCUniZXing.a', 'libuchardet.a'],
    sdks: ['AVFoundation.framework', 'ImageIO.framework', 'CoreVideo.framework', 'CoreMedia.framework', 'libiconv.2.tbd'],
  },
  Bluetooth: {
    libs: ['liblibBlueTooth.a'],
    sdks: ['CoreBluetooth.framework'],
  },
  Camera: {
    libs: ['liblibCamera.a'],
    sdks: ['AssetsLibrary.framework', 'Accelerate.framework', 'Photos.framework', 'CoreMedia.framework', 'MetalKit.framework', 'GLKit.framework'],
    bundles: ['DCTZImagePickerController.bundle', 'DCMediaEditingController.bundle'],
  },
  Contact: {
    libs: ['liblibContacts.a'],
    sdks: ['AddressBookUI.framework', 'AddressBook.framework', 'AVFoundation.framework', 'CoreVideo.framework', 'CoreMedia.framework'],
  },
  FaceID: {
    libs: ['libDCUniFaceId.a'],
    sdks: ['LocalAuthentication.framework'],
  },
  Fingerprint: {
    libs: ['liblibFingerprint.a'],
    sdks: ['LocalAuthentication.framework'],
  },
  iBeacon: {
    libs: ['liblibBeacon.a'],
    sdks: ['CoreBluetooth.framework', 'CoreLocation.framework'],
  },
  LivePusher: {
    libs: ['liblibLivePush.a', 'libDCUniGPUImage.a', 'UPLiveSDKDll.framework'],
    sdks: [
      'AVFoundation.framework', 'QuartzCore.framework', 'OpenGLES.framework', 'AudioToolbox.framework',
      'VideoToolbox.framework', 'Accelerate.framework', 'CoreMedia.framework', 'CoreTelephony.framework',
      'SystemConfiguration.framework', 'CoreMotion.framework', 'libz.tbd', 'libbz2.tbd', 'libiconv.tbd',
    ],
  },
  Messaging: {
    libs: ['liblibMessage.a'],
    sdks: ['MessageUI.framework'],
  },
  Record: {
    libs: ['liblibMedia.a', 'libopencore-amrnb.a', 'libmp3lame.a', 'DCUniRecord.framework'],
    sdks: ['AVFoundation.framework'],
  },
  SQLite: {
    libs: ['liblibSqlite.a'],
    sdks: ['libsqlite3.0.tbd'],
  },
  // 官方依赖表「Orientation(设备方向)」：liblibOrientation.a + CoreLocation
  Orientation: {
    libs: ['liblibOrientation.a'],
    sdks: ['CoreLocation.framework'],
  },
  UIWebview: {
    libs: ['libH5WEUIWebview.a'],
    sdks: ['JavaScriptCore.framework', 'Foundation.framework', 'UIKit.framework'],
  },
  VideoPlayer: {
    libs: ['libDCUniVideo.a', 'liblibVideo.a', 'DCUniVideoPublic.framework', 'IJKMediaFrameworkWithSSL.framework', 'Masonry.framework'],
    sdks: [
      'libc++.tbd', 'libbz2.tbd', 'libz.tbd', 'AudioToolbox.framework', 'AVFoundation.framework',
      'CoreGraphics.framework', 'CoreMedia.framework', 'CoreVideo.framework', 'VideoToolbox.framework',
      'MediaPlayer.framework', 'MobileCoreServices.framework', 'OpenGLES.framework', 'QuartzCore.framework',
      'UIKit.framework',
    ],
    bundles: ['DCSVProgressHUD.bundle', 'DCPGVideo.bundle'],
  },
}

// 需要 sdkConfigs 判定三方 SDK 的模块：manifest 模块标识 -> sdkConfigs 键
const MODULE_SDK_CONFIG = {
  Geolocation: 'geolocation',
  Maps: 'maps',
  OAuth: 'oauth',
  Payment: 'payment',
  Push: 'push',
  Share: 'share',
  Speech: 'speech',
  Statistic: 'statics',
}

// UniPush 与个推共用同一组系统库
const PUSH_SDKS = [
  'libc++.tbd', 'libsqlite3.0.tbd', 'libz.tbd', 'libresolv.tbd', 'UserNotifications.framework',
  'Security.framework', 'MobileCoreServices.framework', 'SystemConfiguration.framework',
  'CoreLocation.framework', 'AVFoundation.framework', 'CoreTelephony.framework',
]

const SDK_CONFIG_DEPS = {
  geolocation: {
    system: {
      libs: ['liblibGeolocation.a'],
      sdks: ['Foundation.framework', 'CoreLocation.framework'],
    },
    amap: {
      libs: ['libAMapLocationPlugin.a', 'liblibGeolocation.a', 'AMapFoundationKit.framework', 'AMapLocationKit.framework'],
      sdks: [
        'libc++.tbd', 'libz.tbd', 'ExternalAccessory.framework', 'GLKit.framework',
        'Security.framework', 'CoreTelephony.framework', 'SystemConfiguration.framework',
      ],
    },
    baidu: {
      libs: [
        'libBaiduLocationPlugin.a', 'libBaiduKeyVerify.a', 'liblibGeolocation.a', 'libssl.a', 'libcrypto.a',
        'BaiduMapAPI_Utils.framework', 'BaiduMapAPI_Base.framework', 'BaiduMapAPI_Search.framework', 'BMKLocationKit.framework',
      ],
      sdks: [
        'libc++.tbd', 'libsqlite3.0.tbd', 'SystemConfiguration.framework', 'Security.framework',
        'CoreLocation.framework', 'CoreTelephony.framework',
      ],
    },
  },
  maps: {
    baidu: {
      libs: [
        'BaiduMapAPI_Utils.framework', 'BaiduMapAPI_Base.framework', 'BaiduMapAPI_Search.framework', 'BaiduMapAPI_Map.framework',
        'BMKLocationKit.framework', 'liblibMap.a', 'libbmapimp.a', 'libBaiduKeyVerify.a', 'libssl.a', 'libcrypto.a',
      ],
      sdks: [
        'libc++.tbd', 'libsqlite3.0.tbd', 'libz.tbd', 'QuartzCore.framework', 'CoreGraphics.framework',
        'CoreTelephony.framework', 'Accelerate.framework', 'SystemConfiguration.framework', 'Security.framework',
        'MapKit.framework', 'OpenGLES.framework', 'CoreLocation.framework',
      ],
      bundles: ['mapapi.bundle'],
    },
    // 官方：高德地图仅 nvue 页面支持，使用 DCUniMap 套件
    amap: {
      libs: [
        'libDCUniMap.a', 'libDCUniAmap.a', 'Masonry.framework', 'AMapSearchKit.framework',
        'MAMapKit.framework', 'AMapFoundationKit.framework',
      ],
      sdks: ['MapKit.framework', 'CoreLocation.framework', 'libc++.tbd', 'GLKit.framework'],
      bundles: ['AMap.bundle', 'userPosition@2x.png'],
    },
    google: {
      libs: [
        'libDCUniMap.a', 'libDCUniGoogleMap.a', 'GoogleMapsBase.framework', 'GoogleMaps.framework',
        'GoogleMapsCore.framework', 'liblibMap.a',
      ],
      sdks: [
        'Accelerate.framework', 'CoreData.framework', 'CoreGraphics.framework', 'CoreImage.framework',
        'CoreLocation.framework', 'CoreTelephony.framework', 'CoreText.framework', 'GLKit.framework',
        'ImageIO.framework', 'libc++.tbd', 'libz.tbd', 'Metal.framework', 'OpenGLES.framework',
        'QuartzCore.framework', 'SystemConfiguration.framework',
      ],
      bundles: ['GoogleMaps.bundle'],
    },
  },
  oauth: {
    univerify: {
      libs: ['liblibOauth.a', 'UniVerify.framework', 'GTCommonSDK.xcframework', 'GeYanSdk.xcframework'],
      sdks: ['libz.tbd', 'libc++.tbd', 'libsqlite3.0.tbd', 'AdSupport.framework'],
      bundles: ['TYRZResource.bundle'],
    },
    sina: {
      libs: ['liblibOauth.a', 'libSinaWBOauth.a', 'libWeiboSDK.a'],
      sdks: ['ImageIO.framework', 'libsqlite3.0.tbd'],
      bundles: ['WeiboSDK.bundle'],
    },
    qq: {
      libs: ['liblibOauth.a', 'libQQOauth.a', 'TencentOpenAPI.xcframework'],
    },
    weixin: {
      libs: ['liblibOauth.a', 'libWXOauth.a', 'libWeChatSDK.a'],
      sdks: ['libsqlite3.0.tbd', 'libz.tbd', 'CoreTelephony.framework', 'SystemConfiguration.framework'],
    },
    apple: {
      libs: ['liblibOauth.a', 'libAppleOauth.a'],
      sdks: ['AuthenticationServices.framework'],
    },
    google: {
      libs: ['liblibOauth.a', 'libGoogleOauth.a', 'GoogleSignIn.xcframework', 'AppAuth.xcframework', 'GTMAppAuth.xcframework', 'GTMSessionFetcher.xcframework'],
      sdks: ['CoreText.framework', 'CoreGraphics.framework', 'LocalAuthentication.framework', 'SafariServices.framework', 'Security.framework'],
      bundles: ['GoogleSignIn.bundle'],
    },
    facebook: {
      libs: [
        'liblibOauth.a', 'libFBOauth.a', 'FBSDKCoreKit.xcframework', 'FBAEMKit.xcframework',
        'FBSDKCoreKit_Basics.xcframework', 'FBSDKLoginKit.xcframework',
      ],
      sdks: [
        'libc++.tbd', 'Accelerate.framework', 'Accounts.framework', 'AdSupport.framework',
        'AudioToolbox.framework', 'CoreGraphics.framework', 'QuartzCore.framework', 'Security.framework',
        'Social.framework', 'StoreKit.framework',
      ],
    },
  },
  payment: {
    alipay: {
      libs: ['liblibPayment.a', 'libalixpayment.a', 'AlipaySDK.xcframework'],
      sdks: ['Security.framework', 'CoreMotion.framework', 'SystemConfiguration.framework', 'CFNetwork.framework', 'libc++.tbd'],
      bundles: ['AlipaySDK.bundle'],
    },
    weixin: {
      libs: ['liblibPayment.a', 'libwxpay.a', 'libWeChatSDK_pay.a'],
      sdks: ['libsqlite3.0.tbd', 'libz.tbd', 'CoreTelephony.framework', 'SystemConfiguration.framework'],
    },
    appleiap: {
      libs: ['liblibPayment.a', 'libIAPPay.a'],
      sdks: ['StoreKit.framework'],
    },
    paypal: {
      libs: ['liblibPayment.a', 'libpaypalpay.a', 'PayPalCheckout.xcframework'],
    },
    stripe: {
      libs: [
        'libstripepay.a', 'liblibPayment.a', 'StripeApplePay.xcframework', 'StripeCore.xcframework',
        'StripeUICore.xcframework', 'Stripe3DS2.xcframework', 'StripePayments.xcframework',
        'StripePaymentsUI.xcframework', 'StripePaymentSheet.xcframework',
      ],
    },
  },
  push: {
    // 个推：在线推送通道
    igexin: {
      libs: ['liblibPush.a', 'libGeTuiPush.a', 'GTSDK.xcframework'],
      sdks: PUSH_SDKS,
    },
    // uniPush 2.0：勾了离线推送才需要 iOS 原生 SDK（离线走 APNs），仅在线推送用 jssdk
    unipush: {
      libs: ['liblibPush.a', 'libUniPush.a', 'GTSDK.xcframework'],
      sdks: PUSH_SDKS,
      offlineOnly: true,
    },
    // 谷歌推送（官方 iOS push.html「Google Cloud Message 3.3.7+ 新增」）：与 uniPush/个推并列的独立集成，
    // 依赖 libFCMPush.a + Firebase 系列 xcframework，资源只有 GoogleService-Info.plist（工程自带）
    fcm: {
      libs: [
        'liblibPush.a', 'libFCMPush.a',
        'FirebaseCore.xcframework', 'FirebaseCoreInternal.xcframework', 'FirebaseInstallations.xcframework',
        'GoogleDataTransport.xcframework', 'GoogleUtilities.xcframework', 'FBLPromises.xcframework',
        'nanopb.xcframework', 'FirebaseMessaging.xcframework',
      ],
      sdks: ['UserNotifications.framework'],
    },
  },
  share: {
    sina: {
      libs: ['liblibShare.a', 'libSinaShare.a', 'libWeiboSDK.a'],
      sdks: ['ImageIO.framework', 'libsqlite3.0.tbd'],
      bundles: ['WeiboSDK.bundle'],
    },
    qq: {
      libs: ['liblibShare.a', 'libQQShare.a', 'TencentOpenAPI.xcframework'],
    },
    weixin: {
      libs: ['liblibShare.a', 'libweixinShare.a', 'libWeChatSDK.a'],
      sdks: ['libsqlite3.0.tbd', 'libz.tbd', 'CoreTelephony.framework', 'SystemConfiguration.framework'],
    },
  },
  speech: {
    baidu: {
      libs: ['liblibSpeech.a', 'libBaiduSpeechSDK.a', 'libbaiduSpeech.a'],
      sdks: [
        'libc++.tbd', 'libz.tbd', 'libsqlite3.0.tbd', 'AudioToolbox.framework', 'AVFoundation.framework',
        'CFNetwork.framework', 'CoreLocation.framework', 'CoreTelephony.framework',
        'SystemConfiguration.framework', 'GLKit.framework',
      ],
      bundles: [{ name: 'BDSClientEASRResources', folder: true }],
    },
  },
  statics: {
    umeng: {
      libs: ['liblibStatistic.a', 'libUmengStatistic.a', 'UMDevice.xcframework', 'UMCommon.xcframework', 'UMAPM.framework'],
      sdks: ['libz.tbd', 'libsqlite3.0.tbd', 'SystemConfiguration.framework', 'CoreTelephony.framework'],
    },
    google: {
      libs: [
        'liblibStatistic.a', 'libGoogleStatistic.a', 'FirebaseCore.xcframework', 'FirebaseCoreInternal.xcframework',
        'FirebaseInstallations.xcframework', 'GoogleAppMeasurement.xcframework',
        'GoogleAppMeasurementIdentitySupport.xcframework', 'GoogleUtilities.xcframework',
        'FBLPromises.xcframework', 'nanopb.xcframework',
      ],
    },
  },
}

function readDirMap(dir) {
  const map = new Map()
  if (!fs.existsSync(dir)) return map
  fs.readdirSync(dir).forEach((name) => map.set(name.toLowerCase(), name))
  return map
}

const dynamicCache = new Map()

// 动态 framework 必须 embed，否则运行时找不到符号；静态库 embed 反而会出问题
function isDynamicFramework(file) {
  if (file.endsWith('.a')) return false
  if (dynamicCache.has(file)) return dynamicCache.get(file)

  let binary = file
  if (file.endsWith('.xcframework')) {
    const name = path.basename(file, '.xcframework')
    binary = ['ios-arm64', 'ios-arm64_x86_64-simulator', 'ios-arm64_x86_64-maccatalyst']
      .map((slice) => path.join(file, slice, `${name}.framework`, name))
      .find((candidate) => fs.existsSync(candidate))
  } else if (file.endsWith('.framework')) {
    binary = path.join(file, path.basename(file, '.framework'))
  }

  let dynamic = false
  if (binary && fs.existsSync(binary)) {
    try {
      dynamic = execFileSync('file', ['-b', binary], { encoding: 'utf8' }).includes('dynamically linked')
    } catch {
      dynamic = false
    }
  }
  dynamicCache.set(file, dynamic)
  return dynamic
}

function mergeBaseYml(baseYml) {
  const seenDependencies = new Set()
  const seenSources = new Set()
  if (!fs.existsSync(baseYml)) return { seenDependencies, seenSources }

  const content = fs.readFileSync(baseYml, 'utf8')
  for (const match of content.matchAll(/^\s*-\s*(?:sdk|framework):\s*([^\s#]+)/gm)) {
    seenDependencies.add(match[1])
  }
  for (const match of content.matchAll(/^\s*-\s*path:\s*([^\s#]+)/gm)) {
    seenSources.add(match[1])
  }
  return { seenDependencies, seenSources }
}

// base.yml 的编译选项：-ObjC 保证三方静态库的分类方法被链接进来；GCC_PREPROCESSOR_DEFINITIONS
// 是旧版 SDK 的模块裁剪宏。官方没有给出「模块 → 宏」对照表，只在缺失时提示按 common.html 检查。
function checkBaseYmlFlags(baseYmlPath) {
  const warnings = []
  if (!fs.existsSync(baseYmlPath)) return warnings
  const content = fs.readFileSync(baseYmlPath, 'utf8')
  if (!/OTHER_LDFLAGS:[^\n]*-ObjC/.test(content)) {
    warnings.push('config/base.yml 的 OTHER_LDFLAGS 缺少 -ObjC，三方静态库的分类方法可能不生效')
  }
  if (!/GCC_PREPROCESSOR_DEFINITIONS:/.test(content)) {
    warnings.push('config/base.yml 没有 GCC_PREPROCESSOR_DEFINITIONS（宏定义），旧版 SDK 的模块裁剪宏可能需按官方文档补充')
  }
  return warnings
}

// 官方 oauth.html 要求把用到的登录平台登记到 feature.plist 的 OAuth->extend 下，
// 否则运行时找不到对应平台实现。类名以官方截图为准，这里只检查是否登记。
// 按 manifest 把缺失的模块节点补进 feature.plist（幂等，已有节点不覆盖）
export function patchFeaturePlist({ plistPath, modules, sdkConfigs }) {
  const warnings = []
  const added = []
  if (process.platform !== 'darwin') {
    return { warnings: ['feature.plist 模块注册需要 macOS 的 plutil，已跳过'], added }
  }
  if (!fs.existsSync(plistPath)) {
    return { warnings: [`未找到 ${plistPath}，跳过 feature.plist 模块注册`], added }
  }

  const tmpJson = path.join(os.tmpdir(), `uapp-feature-${process.pid}.json`)
  try {
    execFileSync('plutil', ['-convert', 'json', '-o', tmpJson, plistPath])
    const data = JSON.parse(fs.readFileSync(tmpJson, 'utf8'))

    const wanted = new Set()
    Object.keys(modules || {}).forEach((key) => {
      ;(MODULE_FEATURE_KEYS[key] || []).forEach((featureKey) => wanted.add(featureKey))
    })
    wanted.forEach((featureKey) => {
      if (data[featureKey]) return
      const node = FEATURE_NODES[featureKey]
      if (!node) return
      data[featureKey] = JSON.parse(JSON.stringify(node))
      added.push(featureKey)
    })

    const oauth = sdkConfigs?.oauth || {}
    if (data.OAuth) {
      data.OAuth.extend = data.OAuth.extend || {}
      Object.keys(oauth).forEach((provider) => {
        const entry = OAUTH_FEATURE_EXTEND[provider]
        if (!entry || data.OAuth.extend[entry.key]) return
        data.OAuth.extend[entry.key] = entry.className
        added.push(`OAuth.extend.${entry.key}`)
      })
    }

    if (!added.length) return { warnings, added }
    fs.writeFileSync(tmpJson, JSON.stringify(data))
    execFileSync('plutil', ['-convert', 'xml1', '-o', plistPath, tmpJson])
    return { warnings, added }
  } catch (error) {
    warnings.push(`feature.plist 模块注册失败：${error.message}`)
    return { warnings, added: [] }
  } finally {
    fs.rmSync(tmpJson, { force: true })
  }
}

function checkBusinessParams(configKey, provider, value, label) {
  const keys = SDK_CONFIG_PARAMS[configKey]?.[provider]
  if (!keys) return []
  const missing = keys.filter((key) => !value?.[key])
  if (!missing.length) return []
  return [`${label} 缺少 sdkConfigs.${configKey}.${provider} 参数 ${missing.join('、')}，库能链接但运行时会失败`]
}

export function buildIOSModuleYml({ modules, sdkConfigs, privacyDescription, appDir }) {
  const dependencies = []
  const sources = []
  // 按模块分组，写进 custom.yml 时每个模块一个 # <模块名>-start / -end 标记块
  const groups = new Map()
  const groupOf = (name) => {
    if (!groups.has(name)) groups.set(name, { name, dependencies: [], sources: [] })
    return groups.get(name)
  }
  const warnings = []
  const errors = []
  const libsDir = path.join(appDir, 'SDKs/SDK/Libs')
  const bundlesDir = path.join(appDir, 'SDKs/SDK/Bundles')
  if (!fs.existsSync(libsDir)) {
    return {
      groups: [],
      dependencies: [],
      sources: [],
      warnings: ['SDKs/SDK/Libs 不存在，跳过模块依赖写入'],
      errors: [],
    }
  }

  const libFiles = readDirMap(libsDir)
  const bundleFiles = readDirMap(bundlesDir)
  const baseYmlPath = path.join(appDir, 'config/base.yml')
  const { seenDependencies, seenSources } = mergeBaseYml(baseYmlPath)
  if (Object.keys(modules || {}).length) warnings.push(...checkBaseYmlFlags(baseYmlPath))

  const checkPermissions = (keys, label) => {
    const missing = (keys || []).filter((key) => !privacyDescription?.[key])
    if (missing.length) {
      errors.push(`${label} 需要隐私描述 ${missing.join('、')}，请在 manifest 的 app-plus.distribute.ios.privacyDescription 中配置`)
    }
  }

  const add = (dep, label, markName) => {
    const group = groupOf(markName)
    ;(dep.libs || []).forEach((lib) => {
      const actual = libFiles.get(lib.toLowerCase())
      if (!actual) {
        warnings.push(`${label}: SDK 中缺少 ${lib}，已跳过`)
        return
      }
      const projectPath = `SDKs/SDK/Libs/${actual}`
      if (seenDependencies.has(projectPath)) return
      seenDependencies.add(projectPath)

      const embed = isDynamicFramework(path.join(libsDir, actual))
      group.dependencies.push(`- framework: ${projectPath}`, `  embed: ${embed}`, `  codeSign: ${embed}`)
    })

    ;(dep.sdks || []).forEach((sdk) => {
      if (seenDependencies.has(sdk)) return
      seenDependencies.add(sdk)
      group.dependencies.push(`- sdk: ${sdk}`)
    })

    ;(dep.bundles || []).forEach((bundle) => {
      const item = typeof bundle === 'string' ? { name: bundle } : bundle
      const actual = bundleFiles.get(item.name.toLowerCase())
      if (!actual) {
        warnings.push(`${label}: SDK 中缺少资源 ${item.name}，已跳过`)
        return
      }
      const projectPath = `SDKs/SDK/Bundles/${actual}`
      if (seenSources.has(projectPath)) return
      seenSources.add(projectPath)

      group.sources.push(`- path: ${projectPath}`)
      if (item.folder) group.sources.push('  type: folder')
      group.sources.push('  buildPhase: resources')
    })
  }

  Object.keys(modules || {}).forEach((key) => {
    if (MODULE_SDK_CONFIG[key] || IGNORED_MODULES.has(key)) return
    const dep = MODULE_DEPS[key]
    if (!dep) {
      warnings.push(`模块 ${key} 没有对应的 iOS 依赖映射，请手动在 config/custom.yml 配置`)
      return
    }
    checkPermissions(MODULE_PERMISSIONS[key], `模块 ${key}`)
    add(dep, `模块 ${key}`, key)
  })

  Object.entries(MODULE_SDK_CONFIG).forEach(([moduleKey, configKey]) => {
    if (!modules || !(moduleKey in modules)) return

    checkPermissions(SDK_CONFIG_PERMISSIONS[configKey], `模块 ${moduleKey}`)

    const config = sdkConfigs?.[configKey]
    const providers = Object.keys(config || {}).filter((key) => key !== '__platform__')
    if (!providers.length) {
      warnings.push(`模块 ${moduleKey} 已启用，但 sdkConfigs.${configKey} 未配置平台，未自动写入依赖`)
      return
    }

    providers.forEach((provider) => {
      const label = `模块 ${moduleKey} (${configKey}.${provider})`
      const dep = SDK_CONFIG_DEPS[configKey]?.[provider]
      if (!dep) {
        warnings.push(`模块 ${moduleKey} 的 sdkConfigs.${configKey}.${provider} 没有对应的 iOS 依赖映射，请手动配置`)
        return
      }
      warnings.push(...checkBusinessParams(configKey, provider, config[provider], label))
      if (configKey === 'statics' && provider === 'google') {
        warnings.push(`模块 ${moduleKey} (${configKey}.${provider}) 需要工程自带 GoogleService-Info.plist，uapp 不会生成`)
      }
      if (configKey === 'push' && provider === 'fcm' && !fs.existsSync(path.join(appDir, 'GoogleService-Info.plist'))) {
        warnings.push(`模块 ${moduleKey} (${configKey}.${provider}) 需要在工程根目录放 Firebase 的 GoogleService-Info.plist，uapp 不会生成`)
      }
      // uniPush 2.0 仅在线推送时不集成个推原生 SDK
      if (dep.offlineOnly && config[provider]?.offline !== true) {
        warnings.push(`模块 ${moduleKey} (${configKey}.${provider}) 未勾选离线推送，base.yml 仍包含 UniPush 依赖；不需要时请从 base.yml 移除`)
        return
      }
      add(dep, label, `${moduleKey}.${provider}`)
    })

  })

  const allGroups = [...groups.values()]
  return {
    groups: allGroups,
    dependencies: allGroups.flatMap((group) => group.dependencies),
    sources: allGroups.flatMap((group) => group.sources),
    warnings,
    errors,
  }
}
