![uapp.dev](https://raw.githubusercontent.com/zencodex/art/refs/heads/main/logo.png)

## uapp 能做什么

```js
// what's uapp
const uapp = 'universal app'
```

uapp源自跨平台开发的最佳实践, 通过集成 uni-app, electron, tauri，让开发者仅需维护一套代码，就能横扫所有平台。

uapp支持所有的手机端(android, ios)，支持所有的电脑端(windows, mac osx, linux)，支持所有的小程序，浏览器插件等等。

uapp让Web开发者能搞更多事情，会H5就可以无限制重构一切软件。

- [x] 开发微信小程序时，仅运行 `uapp run dev:mp-weixin --open`，就能生成小程序代码，并直接打开微信开发者工具加载。
- [x] 开发APP离线基座，仅运行 `uapp run build:app`，就能生成自定义基座安装包，且自动发布到 hbx 工程下面直接使用。
- [x] `uapp info` 可以查看包名, 签名 md5, dcloudkey, jwt 等开发中用到的各种信息。

多一个平台，就多了一个流量渠道，多一个平台，就多个用户选择的理由，而做这些事，仅需维护一套代码。哪怕只开发一个平台，同样花时间写代码，为什么不选择复用价值更高的方法呢。

## 一、先安装 uappsdk

1、 安装 uapp 命令

```bash
npm install -g uapp

# 初始化或更新 uappsdk
uapp sdk init
```

2、下载 uniapp 离线打包的 SDK

> 注意和.uappsdk区分开，此处的uniapp离线包的SDK是指dcloud 官方发布的

**android 离线打包SDK:**

<https://nativesupport.dcloud.net.cn/AppDocs/download/android>

**ios 离线打包SDK:**

<https://nativesupport.dcloud.net.cn/AppDocs/download/ios>

解压其中的SDK目录，放入 .uappsdk 文件夹里，最终 .uappsdk 文件夹结构如下:

```
> $HOME/.uappsdk/
.
├── android
│   ├── SDK # -> 这里是Android的SDK
├── ios
│   ├── SDK # -> 这里是iOS的SDK
└── templates
    └── manifest.json
```

> SDK 相关文件都放在当前用户的 $HOME/.uappsdk 目录下。

需要引入哪些模块，请务必仔细阅读官方的 SDK 模块依赖说明，模块多了会影响APP审核，少了会影响功能使用。

android和ios工程模版仅含有微信授权登录，苹果授权登录，支付等一些基础功能。不包含广告、通知等相关依赖，因为广告和通知类的模块，在审核时需要特别提交数据跟踪说明，比较麻烦。

如不是必须，最好不包含。如果确实需要，可以自行手动添加，参照如下模块依赖说明。

**android 模块依赖说明:**

针对 android，将依赖的包名放入工程目录 `app/sdk.libs` 文件内，每个包名一行。
<https://nativesupport.dcloud.net.cn/AppDocs/usemodule/androidModuleConfig/android_Library>

**ios 模块依赖说明:**

<https://nativesupport.dcloud.net.cn/AppDocs/usemodule/iOSModuleConfig/common>

## 二、webapp 工程 (重点看) 🔥

### webapp 工程下小程序及H5直接编译

```bash
uapp run dev:h5
uapp run dev:mp-weixin
uapp run build:h5
uapp run build:mp-weixin

# electron 为自定义环境
# 自定义环境教程：https://uniapp.dcloud.net.cn/collocation/package.html
uapp run build:electron
```

**自动化测试**

```shell
# 使用 HBuilderX 内置 Node/Jest 自动化测试
uapp run test:web-chrome
uapp run test:web-firefox
uapp run test:web-safari
uapp run test:mp-weixin
uapp run test:app-android
uapp run test:app-ios-simulator
uapp run test:app-ios
uapp run test:app-harmony
```

测试 API 文档:
https://uniapp.dcloud.net.cn/worktile/auto/api.html

👇 **uapp 编译微信小程序并打开工程**

![mp-weixin build](https://uappx.oss-cn-hangzhou.aliyuncs.com/repo/weixin.gif)

其他更多命令，可直接参考：

<https://gitee.com/dcloud/uni-preset-vue/blob/vite/package.json>

### webapp 工程的创建及配置

第一种：通过 `uapp new` 新建工程，使用 `uapp-webapp` 模版。

`uapp-webapp` 模版里集成了 unocss/tailwindcss, uvui。自带网络请求配置，可直接使用 uni.$uv.http，使用方法，可以参考模版里自带的 README 文档:
<https://gitee.com/uappkit/platform/tree/main/src>

```bash
# 默认使用 uapp-webapp 模版
uapp new YourProject
```

第二种，通过 HBuilderX 菜单里新建工程，使用官方自带模版。

**创建好 webapp 工程后，一定要参照下面流程，获取 appid，和添加 uapp 节点。**

☘️ HBuilderX 打开工程，再选中 manifest.json 配置

- (必须) 基础配置 => 确定获取到 appid
- (必须) 源码视图 => versionCode 下面添加 uapp 节点，内容如下：

```json5
{
  // ...
  "versionCode": "100",
  "uapp": {
    "package": "com.code0xff.uapp",
    "android.appkey": "申请并替换为 android dcloudkey",
    "ios": {
      // base / release 必填; test / sim 未填的字段回退 base
      "base": { "package": "com.code0xff.uapp", "appkey": "base 的 dcloudkey" },
      // test / sim 可只填部分字段, 也可整个节点省略 (全部回退 base)
      "test": { "package": "com.code0xff.uapp.test", "appkey": "test 的 dcloudkey" },
      "release": { "package": "com.code0xff.uapp", "appkey": "release 的 dcloudkey" }
    }
  },
  // ...
}
```

- (建议) App图标配置 => 浏览选择图标文件 => 自动生成

- (建议) App模块配置 => OAuth 登录鉴权 => (微信登录, iOS Universal Links)

> 👉 `dcloudkey` 后台申请的链接，和要填写的内容，可通过 `uapp info` 命令查看，非常方便。

## 三、离线打包工程

例如有个 demo1 项目，想将 android, ios, webapp 源码放在一起，可参考如下目录结构:

```bash
# 保持这个目录结构和名字，就不需要 `uapp manifest` 命令来定位 src 下的 manifest.json

  demo1
      ├── android  # android 源码 (uapp add android)
      ├── ios      # ios 源码 (uapp add ios)
      └── src      # webapp 源码 (可以 uapp new webapp 后，再改名为 src)
```

### 1. 新建 android 工程

`uapp add android`

👇 **uapp 离线打包并发布 Android 自定义基座**

![android build](https://uappx.oss-cn-hangzhou.aliyuncs.com/repo/android.gif)

### 2. 新建 ios 工程

`uapp add ios`

> 如果当前目录已有 android 或 ios 目录，会提示错误，可将其改名后，再执行命令

iOS 的工程化一直都不太方便，通常都是用的 CocoaPods，但不适合 DCloud离线SDK 的发布形式。经过我们在产品中的不断实践，最终选择了 XCodeGen。

👇 **uapp 离线打包并发布 iOS 自定义基座**

![ios build](https://uappx.oss-cn-hangzhou.aliyuncs.com/repo/ios.gif)

### 3. 离线工程下常见命令

> 注意：uapp 从 3.0 开始，放弃了 run build / run build:dev，和 uniapp 一致，方便自定义扩展。

命令格式为 `uapp run build:app*`，vue2 工程用 `uapp run build:app-plus`。必须是 app 开头, 非 app 类型，如 H5 没有这个限制。

自定义扩展，package.json 中添加:

```json5
// 如何使用自定义命令：
// uapp run build:app-codex

{
  "uni-app": {
    "scripts": {
      // app-codex 这里必须是 app 开头, 非 app 类型，如 H5 没有这个限制
      "app-codex": {
        "title": "自定义命令",
        "browser": "",
        "env": {
          "UNI_PLATFORM": "app",
          "CUSTOM_ENV": "123456"
        }
      }
    }
  }
}
```

其他一些命令参考:

```bash
# 读取 manifest 中的配置，并更新基本信息
uapp manifest path/to/manifest.json

# 查看 dcloudkey 和对接第三方平台需要的信息
uapp info

# 更新 HBuilderX 生成的App图标和本地打包资源
uapp prepare build:app

# dev 模式，仅清理资源不检查本地打包资源
uapp prepare build:app dev

# 编译APP安装包, 并发布自定义基座到 HBuilderX 下
uapp run build:app

# 打包为 uapp.wgt, 名字可改
uapp run build:app -r uapp.wgt

# vue2 要使用 app-plus，与 uniapp 一致
uapp run build:app-plus

# 运行自定义打包发布流程，配置见 manifest.json => custom.command
uapp run custom
```

> 👉 iOS 工程上 `uapp prepare` 不知道要打哪种包，只更新版本号 / 图标 / 资源，不写包名和 appkey；
> 包名与 appkey 在 `uapp run build:app base|test|sim|release` 时按构建类型写入。

### Android 多渠道打包

支持 origin(默认), huawei, honor, xiaomi, vivo, oppo, meizu 渠道，格式为 `apk:渠道` 或 `dev:渠道`。

```bash
# 编译 release 发布包 (origin 渠道)
uapp run build:app apk

# 编译华为渠道 release 包
uapp run build:app apk:huawei

# 编译华为渠道 debug 包
uapp run build:app dev:huawei

# 编译所有渠道 release 包
uapp run build:app apk:all

# 打包为 aab 格式 (发布到 Google Play)
uapp run build:app aab

# 编译后上传到蒲公英
uapp run build:app apk:huawei upload
```

### iOS 构建类型

```bash
# 编译真机自定义基座
uapp run build:app base

# 编译测试包 (默认共用 export_dev.plist; export=own 时用 export_test.plist)
uapp run build:app test

# 编译 iOS 模拟器包 (x86_64, iPhone 17 Simulator)
uapp run build:app sim

# 编译测试包并上传蒲公英
uapp run build:app test upload

# 编译 release 发布包 (使用 export_release.plist, 签名改 uapp_release.yml)
uapp run build:app release
```

## 四、manifest.json 相关配置

> 注意: `uapp.* 参数` 是 uapp 根据需要扩展出来的, 非 dcloud 官方标准.

原工程里的 `manifest.json` 内的参数，大多是给 hbuiderx 在线云打包用的。编译后生成的终极发布包，里面的 manifest.json 已被去除了无关数据，所以不用担心参数暴露问题。

```json
{
  "name": "uapp",
  "appid": "__UNI__ECA8F4D",
  "versionName": "1.0.1",
  "versionCode": "1000000",
  "uapp": {
    "package": "com.code0xff.uapp",
    "android.appkey": "b4ab7d1c668cbb3b257aeeabd75c29da",
    "ios": {
      "base": { "package": "com.code0xff.uapp", "appkey": "aa215ff1522abe39cb7ccec5943eeb92" },
      "test": { "package": "com.code0xff.uapp.test", "appkey": "test 的 dcloudkey" },
      "release": { "package": "com.code0xff.uapp", "appkey": "release 的 dcloudkey" }
    },
    "custom.command": "cd ${SRC}/../android && uapp run build:app && node publish_apk.js"
  },
  "app-plus": {
    "distribute": {
      "sdkConfigs": {
        "oauth": {
          "weixin": {
            "appid": "wx95039516c9f72e50",
            "appsecret": "123456",
            "UniversalLinks": "https://uapp.code0xff.com/"
          }
        }
      }
    }
  }
}
```

### 🔥 uapp.* 参数说明

👉 不同平台可以用前缀区分

<blockquote>
versionName, versionCode 如果需要平台差异化定义, 可以加前缀 android.*, ios.*

例如 android.versionName, android.versionCode, ios.versionName, ios.versionCode ...

应用名统一取根节点的 name, `uapp.name` / `uapp.<platform>.name` 已废弃（不再读取）.

iOS 的 package / appkey 按构建类型写在 `uapp.ios.{base|test|sim|release}` 里:
base / release 必填, test / sim 未填的字段回退 base（旧的 `ios.package` / `ios.appkey` 已废弃）.
Google 登录的 iOS client id 也可以写在同一节点: 正式包不用填（沿用标准字段）,
测试包写 `uapp.ios.test.googleClientId`.

test 包的导出配置跟随 `uapp.ios.test.export`: `dev`（默认，共用 `config/export_dev.plist`，
开发签名打调试包）、`release`（共用 `config/export_release.plist`，与正式包同一种导出方式）
或 `own`（用工程里自己的 `config/export_test.plist`，适合测试包 ad-hoc + 正式包 App Store 这类
method 不同的场景）。

custom.command 参数内，可以使用 `${SRC}, ${SRC}` 为当前 manifest.json 的同级目录，支持加 ../定位上一级目录，避免用绝对路径。
</blockquote>

👇👇 👇

| uapp.* 参数      | 说明                                                                                     |
|:---------------|----------------------------------------------------------------------------------------|
| name           | 已废弃, 不再读取。APP名字统一取根节点的 name（根 name 必填, 缺失时打包报错）                          |
| package        | 应用的包名（Android 使用）。不同平台可以加前缀区分，如 android.package。iOS 见 uapp.ios.*                                 |
| android.appkey | DCloud平台申请的，Android 平台 dcloud_appkey，下方有申请地址                                           |
| ios.base / ios.test / ios.sim / ios.release | iOS 每个构建类型的 `{ package, appkey, googleClientId }`。base / release 必填；test / sim 未填的字段回退 base。`googleClientId` 是 Google 登录的 iOS client id（正式包不填，沿用 `app-plus.distribute.sdkConfigs.oauth.google.clientid`）。`ios.test.export` 可选 `dev`(默认) / `release` / `own`，决定测试包用哪份导出配置 |
| versionName    | App版本名，同上可以加前缀区分不同平台。如 android.versionName                                             |
| versionCode    | App版本Code，同上可以加前缀区分不同平台。如 ios.versionCode                                              |
| custom.command | (选填) uapp run custom 执行的自定义命令。比如一条命令里做很多事: `uapp run build:app && node publish_apk.js` |

### 🔒 iOS 权限文案（privacyDescription）

本地打包和云端打包不同，`Info.plist` 来自模板工程，所以 uapp 会读取 `app-plus.distribute.ios.privacyDescription` 自己同步：

```json5
{
  "app-plus": {
    "distribute": {
      "ios": {
        "privacyDescription": {
          // 键名就是 Info.plist 的键名
          "NSCameraUsageDescription": "需要使用相机拍摄照片用于设置头像",
          "NSPhotoLibraryUsageDescription": "需要访问相册，以便上传您选择的图片"
        }
      }
    }
  }
}
```

- 已有键覆盖，模板里没有的键会自动插入（相机、相册、定位、通讯录等模板都没预置）
- 只写入本次构建类型对应的 Info.plist：base/test/sim → `AppDev/Info.plist`，release → `AppRelease/Info.plist`
- 值不做国际化展开，`%app.ios.des.camera%` 这类占位符会原样写入

### 🔗 iOS URL Scheme 与白名单

同样来自 manifest 的标准字段，uapp 会写进本次构建类型的 `Info.plist`：

```json5
{
  "app-plus": {
    "distribute": {
      "ios": {
        "urltypes": "weixin,myapp",              // 逗号分隔，写入 CFBundleURLName=scheme 那条的 CFBundleURLSchemes
        "urlschemewhitelist": "weixin,alipay"    // 逗号分隔，写入 LSApplicationQueriesSchemes
      },
      "sdkConfigs": {
        "oauth": {
          "google": { "clientid": "123-abc.apps.googleusercontent.com" }
        }
      }
    }
  }
}
```

- `google.clientid` 会写两处：`GIDClientID` 用原值，`CFBundleURLName=google_url` 那条的
  scheme 用**倒序**（`123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`）
- Google 的 iOS client id 绑定 bundle id，正式版和测试版包名不同就得各申请一个：
  正式包（base / release）不用填，沿用 `sdkConfigs.oauth.google.clientid`；测试版写在
  `uapp.ios.test.googleClientId`，按构建类型写进对应的 `Info.plist`
- `AppDev/Info.plist` 被 base / test / sim 三个 target 共用，切换构建类型后要重跑
  `uapp run build:app-plus <type>` 才会覆盖成该构建类型的 client id（release 用独立的
  `AppRelease/Info.plist`，没有这个问题）
- 数组和逗号分隔字符串都支持

### 🌐 iOS 多语言（locale / fallbackLocale）

写到 `Info.plist` 的 `CFBundleLocalizations`：

```json
{ "locale": "ko", "fallbackLocale": "zh-Hant" }
```

- 语言列表 = 根节点 `locale` + `fallbackLocale`（只认 manifest，不扫描 `locale/` 目录：目录里残留的语种文件不会进 App Store 语言列表）
- **不写这个键，iOS 只认 `CFBundleDevelopmentRegion`**，`uni.getSystemInfoSync().language` 永远是开发语言，应用内多语言不会跟随系统切换
- `CFBundleDevelopmentRegion`（系统语言不在支持列表时的兜底）跟随 `fallbackLocale`，保证它始终是 `CFBundleLocalizations` 里的一种；没配 `fallbackLocale` 就不动
- 没配置的字段保持模板原值（模板里的 `fashionkujihk`、`line` 不会被清空）
- 模板里没有 `CFBundleURLTypes` / `LSApplicationQueriesSchemes` / `GIDClientID` 时会自动补齐

### 📱 iOS 屏幕方向（screenOrientation）

`app-plus.screenOrientation` 会写进本次构建类型 `Info.plist` 的 `UISupportedInterfaceOrientations` 与 `UISupportedInterfaceOrientations~ipad`：

```json
{ "app-plus": { "screenOrientation": ["portrait-primary", "landscape-primary"] } }
```

- 映射：`portrait-primary` → `Portrait`，`portrait-secondary` → `PortraitUpsideDown`，`landscape-primary` → `LandscapeLeft`，`landscape-secondary` → `LandscapeRight`
- 数组和逗号分隔字符串都支持
- 不配（或全是识别不了的值）时保持模板原值（模板是四个方向全开），只支持竖屏的项目一定要配，否则离线包仍然是四方向

### 🧩 iOS 模块依赖（modules）

官方说明 `app-plus.modules` 仅云打包生效，离线打包需要自己往原生工程加依赖。uapp 在 iOS 构建时会读取 `modules`，把对应依赖写进 `config/custom.yml` 的 `targetTemplates.uAppBase`（按模块名写进 `# <模块名>-start` 标记块；`uAppBase` 已被手写内容占用时只合并、不覆盖，见下文）：

```json5
{
  "app-plus": {
    "modules": { "Camera": {}, "Push": {} },
    "distribute": {
      "sdkConfigs": { "push": { "unipush": { "version": "2", "offline": true } } }
    }
  }
}
```

- 基础模块：`Barcode`、`Bluetooth`、`Camera`、`Contact`、`FaceID`、`Fingerprint`、`iBeacon`、`LivePusher`、`Messaging`、`Record`、`SQLite`、`UIWebview`、`VideoPlayer`、`Orientation`
- 三方模块按 `sdkConfigs` 的平台子键选依赖：`Geolocation`（`geolocation`）、`Maps`（`maps`）、`OAuth`（`oauth`）、`Payment`（`payment`）、`Push`（`push`）、`Share`（`share`）、`Speech`（`speech`）、`Statistic`（`statics`）
- 三方模块启用了但 `sdkConfigs` 没配平台，或平台没有对应映射时只告警，不猜依赖
- `Push` 只处理 iOS 需要的部分：`push.igexin`（个推，在线推送）始终写入；`push.unipush`（uniPush 2.0）只有 `offline: true`（勾了离线推送）才写 iOS 原生依赖，仅在线推送时用 jssdk 不集成原生 SDK；`push.fcm`（谷歌推送）iOS 直接忽略；uniPush 未勾离线推送时会提醒 base.yml 仍带 UniPush 依赖
- 依赖清单来自 DCloud 官方 [iOS 模块配置文档](https://nativesupport.dcloud.net.cn/AppDocs/usemodule/iOSModuleConfig/common.html)；高德地图按官方「仅 nvue 页面支持」使用 `DCUniMap` 套件
- 动态 framework（如 `GoogleSignIn`、`Stripe*`）自动 `embed` + `codeSign`，静态库不 embed
- SDK 里找不到的库 / 资源会告警并跳过；`base.yml` / `custom.yml` 已有的依赖不重复写入
- **隐私描述必填**：模块启用后必须在 `app-plus.distribute.ios.privacyDescription` 里配置对应键，缺失时打包直接失败并列出缺的键：

  | 模块 | 需要的键 |
  | --- | --- |
  | `Barcode` | `NSCameraUsageDescription` |
  | `Bluetooth` / `iBeacon` | `NSBluetoothPeripheralUsageDescription`、`NSBluetoothAlwaysUsageDescription` |
  | `Camera` | `NSCameraUsageDescription`、`NSPhotoLibraryUsageDescription`、`NSPhotoLibraryAddUsageDescription`、`NSMicrophoneUsageDescription` |
  | `Contact` | `NSContactsUsageDescription` |
  | `FaceID` | `NSFaceIDUsageDescription` |
  | `LivePusher` | `NSCameraUsageDescription`、`NSMicrophoneUsageDescription` |
  | `Record` / `Speech` | `NSMicrophoneUsageDescription` |
  | `Geolocation` | `NSLocationWhenInUseUsageDescription` |
  | `Maps` | `NSLocationWhenInUseUsageDescription`、`NSLocationAlwaysAndWhenInUseUsageDescription` |

- `statics.google`（Firebase Analytics）需要工程里自带 `GoogleService-Info.plist`，uapp 只提醒不生成
- **业务参数**：各平台在 `sdkConfigs` 里必须填的 iOS 参数会检查，缺了只告警（库能链接但运行时会失败）：
  `oauth.weixin` / `oauth.qq` / `oauth.facebook` / `payment.weixin` / `share.weixin` / `share.qq` 需要 `appid`；`oauth.sina` / `share.sina` 需要 `appkey`、`redirect_uri`；`oauth.google` 需要 `clientid`；`payment.paypal` / `payment.stripe` 需要 `returnURL_ios`；`speech.baidu` 需要 `appid`、`apikey`、`secretkey`；`geolocation.*` / `maps.*` / `statics.umeng` 需要 `appkey_ios`；`maps.google` 需要 `APIKey_ios`；`statics.google` 需要 `config_ios`
- **宏定义 / LinkerFlags**：`config/base.yml` 缺 `OTHER_LDFLAGS: -ObjC` 或缺 `GCC_PREPROCESSOR_DEFINITIONS` 时告警；官方没有「模块 → 宏」对照表，具体值按 [common.html](https://nativesupport.dcloud.net.cn/AppDocs/usemodule/iOSModuleConfig/common.html) 手动补

### 📦 iOS 模块注册（feature.plist）

`PandoraApi.bundle/feature.plist` 是 PDRCore 的插件注册表：**只有在这里登记过的模块，对应的 `plus.xxx` 对象才会被注入**。离线 SDK 自带的 `feature.plist` 只有 25 个基础 key，HBuilderX 标准基座是 44 个——差的就是业务模块。

云打包由 DCloud 服务端按 `modules` 自动补节点，所以云打包不会踩这个坑；离线打包/自定义基座没有这一步，表现是**库都链接了、权限也声明了，但运行时仍提示「打包时未添加XX模块」**（例如 `plus.gallery` 报「未打包相册模块」）。

uapp 在 iOS 构建时按 `modules` + `sdkConfigs` 自动补缺失节点，已存在的节点不覆盖，重复打包幂等：

| manifest 模块 | 补的 feature.plist key | class |
| --- | --- | --- |
| `Barcode` | `barcode` | `PGBarcode` |
| `Bluetooth` | `Bluetooth` | `libBlueTooth` |
| `Camera` | `Camera` + `Gallery` | `PGCamera` / `PGGallery` |
| `Contact` | `Contacts` | `PGContacts` |
| `Fingerprint` | `fingerprint` | `Fingerprint` |
| `Geolocation` | `Geolocation` | `PGGeolocation` |
| `iBeacon` | `iBeacon` | `PGBeacon` |
| `LivePusher` | `LivePusher` | `PGLivePush` |
| `Maps` | `Maps` | `PGMap` |
| `Messaging` | `Messaging` | `PGMessaging` |
| `Payment` | `Payment` | `PGPlatbyManager` |
| `Record` | `Record` | `PGRecord` |
| `Share` | `Share` | `PGShareManager` |
| `Speech` | `Speech` | `PGSpeech` |
| `Statistic` | `Statistic` | `UmengStatistic` |

- `Camera` 会同时补 `Gallery`：`uni.chooseImage` 在 App 端调的是 `plus.gallery.pick()`，只声明 `Camera` 不够
- `Push`、`SQLite`、`VideoPlayer`、`Orientation` 离线 SDK 已内置，不补；`FaceID`、`UIWebview` 没有独立节点
- `sdkConfigs.oauth` 的平台写进 `OAuth` → `extend`（`apple`、`google` 已内置）：

  | provider | extend key | class |
  | --- | --- | --- |
  | `weixin` | `weixin` | `PGWXOauth` |
  | `qq` | `qq` | `PGQQOauth` |
  | `sina` | `weibo` | `PGSinaWBOauth` |
  | `univerify` | `univerify` | `PGUniVerify` |
  | `facebook` | `facebook` | `PGFBOauth` |

- 写入位置是 `SDKs/SDK/Bundles/PandoraApi.bundle/feature.plist`。工程里的 `SDKs/SDK` 是指向 SDK 目录的软链，所以补丁会落到 `~/.uappsdk/ios/SDK`，**本机所有项目共用**；换 SDK 版本后下次打包会自动再补。PDRCore 对未链接的模块会跳过，多注册不影响运行
- 模块相关的告警和 `✅ feature.plist 已注册模块：Camera, Gallery` 会在构建流程末尾（xcodebuild 之后）统一输出，不会被编译日志冲掉；没有新增时会输出 `✅ iOS 模块依赖与 feature.plist 均已是最新`。`plutil` 不可用（非 macOS）或文件缺失时告警并跳过

### 🧩 iOS 原生插件（nativePlugins）

离线打包时，uapp 会按 manifest 里启用的原生插件同步插件配置：

```json5
{
  "app-plus": {
    "nativePlugins": {
      "TestPlugin": { "appkey": "abc123", "env": "prod" }   // 插件标识 → 插件参数
    }
  }
}
```

- 插件目录：`nativeplugins/<插件标识>/`，读取其 `package.json` 里的 `_dp_nativeplugin.ios`
- `dcloud_uniplugins` 是离线打包的插件注册表，**必须和 manifest 一致**，否则插件等于没引用；CLI 用 `hooksClass` + `plugins[{type,name,class}]` 整段重写该数组，旧的手写/过期注册会被移除并提示
- `plists` / `capabilities.plists` 合并进本次构建类型的 `Info.plist`（`plists` 优先，嵌套 object 逐层写入，不覆盖同 dict 下已有键）
- `parameters` 按 `<参数名>` 从 `nativePlugins.<插件标识>` 取值，`key` 用 `:` 分层写入 `Info.plist`，`value` 里的 `${参数名}` 会被替换；参数定义优先用插件 `package.json` 的 `_dp_nativeplugin.ios.parameters`，没声明时回退 manifest 里 HBuilderX 记录的 `__plugin_info__.parameters`（按 `platforms` 过滤掉非 iOS 插件）
- 参数没填（或解析后为空）时**不写占位键**，只打印告警提示该插件可能未生效；填了值才写入 Info.plist
- `frameworks` 里的系统库（`UIKit.framework`、`libz.tbd` 等）写成 `- sdk:`，插件目录里的第三方库写成 `- framework:`；`embedFrameworks` 里的会 `embed` + `codeSign`
- 插件 `ios` 根目录下的 `.a` / `.framework` / `.xcframework` 自动加入（与云打包一致）
- `resources` / `assets` 写成 `buildPhase: resources`，无扩展名的目录补 `type: folder`
- 以上依赖写进 `config/custom.yml` 的 `targetTemplates.uAppBase`，**每个模块/插件单独一个标记块**（注释就是模块名），分别包在 `dependencies` / `sources` 列表里：

  ```yaml
  targetTemplates:
      uAppBase:
          dependencies:
              - sdk: SafariServices.framework      # 手写的，保留
              # Camera-start (自动生成, 勿手改)
              - framework: SDKs/SDK/Libs/liblibCamera.a
                embed: false
              - sdk: AssetsLibrary.framework
              # Camera-end
              # OAuth.google-start (自动生成, 勿手改)
              - framework: SDKs/SDK/Libs/libGoogleOauth.a
                embed: false
              # OAuth.google-end
  ```

  - 块名规则：普通模块用 manifest 里的模块名（`Camera`）；`sdkConfigs` 的平台用 `模块.平台`（`OAuth.google`、`Maps.baidu`）；原生插件用插件标识（`sn-adjust1`）
  - 标记块内每次构建**整块重写**：关掉模块/插件后对应块自动移除，块空了连标记一起删
  - 标记块外的手写内容不动；按库文件名（`- sdk:` / `- framework:` / `- path:` 的值取 basename）去重，已手写的不重复加
  - 只有带 `(自动生成, 勿手改)` 后缀的 `-start` 注释才被认作 uapp 的块，手写的 `# apple登录-start` 之类不受影响
  - 如果已经有手写的插件块 `# <插件标识>原生插件-start` / `-end`（HBuilderX 原生插件市场生成的写法），uapp **不新建块**，只把该插件缺的依赖追加到这个块的 `-end` 前；块里已有的条目原样保留
  - 重复运行幂等，只有真正新增条目时提示 `✅ 已合并 N 条模块/原生插件依赖到 config/custom.yml`
- `privacies` 声明的隐私键若在最终 `Info.plist` 里缺失，会提示到 `app-plus.distribute.ios.privacyDescription` 补齐
- `base.yml` 里已有的系统库不会重复写入（重复依赖会让 xcodegen 丢掉其他 framework 依赖）
- 暂不支持：`capabilities.entitlements`、`deploymentTarget`、`validArchitectures`

### 🤖 Android 工程配置（SDK 版本 / 权限 / scheme）

本地打包的 `app/build.gradle` 与 `AndroidManifest.xml` 来自模板工程，uapp 会按 manifest 同步：

```json5
{
  "app-plus": {
    "distribute": {
      "android": {
        "minSdkVersion": 22,
        "targetSdkVersion": 36,
        "permissions": ["<uses-permission android:name=\"android.permission.CAMERA\"/>"],
        "excludePermissions": ["<uses-permission android:name=\"android.permission.READ_PHONE_STATE\"/>"],
        "schemes": "myapp"                       // 逗号分隔支持多个
      }
    }
  }
}
```

- `minSdkVersion` / `targetSdkVersion` 写入 `app/build.gradle` 的 `minSdk` / `targetSdk`（也兼容 `minSdkVersion` 写法）
- `permissions` **只增不删**：工程里手工加的权限保留，已经存在的不重复写入
- `excludePermissions` 写成 `tools:node="remove"`，避免被依赖库的 manifest 合并回来；已在工程里的普通声明会被改写成 remove
- `schemes` 写到每个带 `VIEW` intent-filter 的 activity（`PandoraEntry`、`PandoraEntryActivity`），已存在的 scheme 不重复写
- 没配的字段不动工程文件；`android.abiFilters`、`android.manifest` 暂不支持

### 🧩 Android 模块依赖（modules）

iOS 侧把模块依赖写进 `config/custom.yml`，Android 侧对应的是 `android/app/sdk.libs`（每行一个依赖文件名，gradle 模板按行从 `~/.uappsdk/android/SDK/libs` 引入）。uapp 按 manifest 的 `app-plus.modules` / `app-plus.distribute.sdkConfigs` 自动追加，映射依据官方文档 [AppDocs/usemodule/androidModuleConfig](https://nativesupport.dcloud.net.cn/AppDocs/usemodule/androidModuleConfig/)：

- 模块 → 依赖（本机 SDK 已有对应 aar）：`Bluetooth`→`Bluetooth-release.aar`；`Contact`→`contacts-release.aar`；`Fingerprint`→`fingerprint-release.aar`；`iBeacon`→`iBeacon-release.aar`；`Messaging`→`messaging-release.aar`；`SQLite`→`sqlite-release.aar`；`VideoPlayer`→`media-release.aar`+`weex_videoplayer-release.aar`；`LivePusher`→`weex_livepusher-release.aar`；`Webview-x5`→`webview-x5-release.aar`+`weex_webview-x5-release.aar`（`Camera`/`Gallery` 已内置于 `lib.5plus.base-release.aar`，无需额外 aar）
- `Barcode`、`Record`、`Orientation`、`Proximity`、`Share` 等模块已包含在 `lib.5plus.base-release.aar` 内，无需额外依赖
- `sdkConfigs` 平台 → 依赖：`geolocation.baidu/amap`、`maps.baidu/amap/google`、`oauth.weixin/qq/sina/google/facebook/univerify`、`payment.alipay/weixin/paypal/stripe/google`、`push.unipush/igexin/fcm`、`share.weixin/qq/sina`、`speech.baidu/ifly`、`statics.umeng/google`（`oauth.apple`、`payment.appleiap` 仅 iOS，忽略）
- **清理机制（自动判断）**：不生成额外文件。每次打包按当前勾选的模块补齐缺失行；映射表认识、但已不被任何勾选模块需要的行（如取消勾选 `VideoPlayer` 后的 `media-release.aar`）确认无用后直接删除并在构建末尾提示；映射表不认识的行（`lib.5plus.base`、`debug-server`、用户自己加的依赖）一律保留；内容无变化时不动文件
- 依赖文件名支持通配符（如 `AMap3DMap_*.aar`、`open_sdk_*.jar`），gradle 的 `fileTree include` 本身支持
- **缺文件告警**：映射表里的文件在 `~/.uappsdk/android/SDK/libs` 找不到时告警（部分文件 SDK 未提供，如个推 `gtc.aar`、友盟 `umeng-abtest`），请自行补到 SDK libs 目录或改用 maven 依赖
- **第三方 maven 告警**：DCloud 的 aar 只是胶水层，真身是第三方 SDK。模板 `build.gradle` 只内置了微信 SDK；Google 登录（`play-services-auth`）、Google 支付（`play-services-wallet`）、Facebook（`com.facebook.android:facebook-login`）、支付宝/Stripe/PayPal、个推（`gtsdk`+`gtc-dcloud`）、Firebase（FCM/统计）、Google 地图等还需要手动加 maven 依赖。提示前会先检索 `app/build.gradle`，**已经写了对应依赖就不再提示**
- **uniPush 厂商通道**：`unipush` 对象下除 `version`/`offline` 外的键都算厂商（如 `hms:{}`），勾了哪个才提示哪个。按官方 push.html（HBuilderX 3.99+ 仓储方式）提示的是 maven 依赖而非 aar 文件：华为→`com.getui.opt:hwp`+`com.huawei.hms:push`、荣耀→`com.getui.opt:honor`+`com.hihonor.mcs:push`、OPPO→`com.assist-v3:oppo`、vivo→`com.assist-v3:vivo`、小米→`com.getui.opt:xmp`、魅族→`com.getui.opt:mzp`；提示前先检索 `app/build.gradle`，已写不重复提示；根目录 `build.gradle` 需加个推 maven 仓；厂商 appid/key 等参数在 DCloud 开发者中心配置
- Android 不需要 iOS 式的 feature.plist 注册，但**工程的 `dcloud_properties.xml` 需要**：工程模板自带 23 个 feature，官方文档要求勾选模块后在 `app/src/main/assets/data/dcloud_properties.xml` 注册 feature（`Camera`→`Camera`、`VideoPlayer`→`VideoPlayer`、`Barcode`→`Barcode`、`Bluetooth`→`Bluetooth`、`Contact`→`Contacts`、`Fingerprint`→`Fingerprint`、`iBeacon`→`iBeacon`、`LivePusher`→`LivePusher`、`Messaging`→`Messaging`、`SQLite`→`Sqlite`，三方模块还有 `Geolocation`/`Maps`/`OAuth`/`Payment`/`Push`/`Share`/`Speech`/`Statistic`）。uapp 按勾选模块从 SDK 自带的同名文件（41 个 feature）提取节点补进工程文件；`Maps` 按 `sdkConfigs.maps` 的 provider 在 amap/baidu 两个注册值间选择（官方 map.html：只剩谷歌地图时不需要注册）。三方平台还要求在 feature 节点下加 `<module>` 子节点、在 `<services>` 下加 `<service>` 节点（如 `OAuth-Google`/`OAuth-IGETui`/`OAuth-Facebook`、`Payment-Paypal`/`Payment-Stripe`/`Payment-Google`、`Push.unipush`/`fcm`+service `push`、`Statistic-Umeng`/`Statistic-Google`+service、百度地图 service `Maps`），uapp 一并补进（幂等；工程里已有的子节点不重复加）；SDK 里找不到对应节点时告警
- **权限自动写入**：官方文档要求模块勾选后在 AndroidManifest 声明权限（如 Camera→CAMERA、Barcode→CAMERA+VIBRATE+FLASHLIGHT、Contact→GET_ACCOUNTS+WRITE/READ_CONTACTS、Record→RECORD_AUDIO+MODIFY_AUDIO_SETTINGS、LivePusher→网络+存储+录音等 10 项）。uapp 自动把缺的 `<uses-permission>` 补进 `app/src/main/AndroidManifest.xml`（`excludePermissions` 里明确排除的不补）；只有 AndroidManifest.xml 不存在或不可写时才报错中止
- **uses-feature 与 Android 12 蓝牙权限**：官方 others.html 要求 `Barcode`/`LivePusher` 勾选后补 `<uses-feature>`（`android.hardware.camera` 等）；`Bluetooth`/`iBeacon` 在 `targetSdkVersion` 31 及以上需追加 `BLUETOOTH_SCAN`+`BLUETOOTH_CONNECT`（targetSdk 从 manifest `distribute.android.targetSdkVersion` 或 `app/build.gradle` 读取，取不到按 31+ 处理）
- **三方 provider 权限**：官方各三方章节要求的权限（如 geolocation.amap 13 项含 `ACCESS_BACKGROUND_LOCATION`+`FOREGROUND_SERVICE`、高德/百度地图 11 项、谷歌地图 6 项、`share.sina` 的 Wi-Fi 状态权限等）按勾选模块+已配置的 provider 自动补进 AndroidManifest
- 结果在构建流程末尾统一输出（不会被 gradle 日志冲掉），没有新增时输出 `✅ Android 模块依赖已是最新`

## 五、其他参考

### 生成用户注册协议，隐私协议

`uapp privacy`

具体参考: [privacy/README.md](uappsdk/templates/privacy/readme.md)

### iOS 苹果授权登录

1、获取到 team_id, client_id, key_id 填入到 jwt/config.json 中，如下：

```json
{
  "team_id": "3DSM494K6L",
  "client_id": "com.code0xff.uapp.login",
  "key_id": "3C7FMSZC8Z"
}
```

2、登录苹果开发者账号，创建并下载签名文件， 改名为jwt/key.txt。

3、运行 `uapp info` 命令查看 JWT Token

👉 参考教程: <http://help.jwt.code0xff.com>

### 如何申请 dcloud_appkey

<https://nativesupport.dcloud.net.cn/AppDocs/usesdk/appkey>

### 如何申请微信 appid

登录微信开发者平台创建APP，审核过后，获取 `weixin.appid, weixin.appsecret` 等参数，用于微信登录，分享，支付等相关参数

<https://open.weixin.qq.com/>

### 跨端开发注意事项

<https://uniapp.dcloud.io/matter.html>

## 六、Win / Mac / Linux 等桌面应用开发

桌面应用可以将 uniapp 编译成 H5，再集成到 electron 或 tauri 中。当需要扩展系统能力时，相关方法如下：

### electron 如何扩展

electron集成了node，可通过`node-gyp`的方法扩展。API 自带了丰富的系统能力，能够满足据绝大多数应用，文档参考如下：

<https://www.electronjs.org/docs/latest/api/app>

> 优点: 对前端没学习难度，会node就行。node能做的，electron也都能做，可充分利用node生态。
>
> 缺点: electron 由于集成了 Chromium，生成安装包很大，动不动就100M上下。

### tauri 如何扩展

tauri是基于`rust`开发，可以通过`rust`生态来扩展，`v2`还处在alpha阶段，新增了手机端支持。`v1`的参考文档如下：

<https://tauri.app/v1/api/js/>

> 优点: 由于利用了系统内嵌的webview，生成安装包很小，通常几M。很方便通过 rust 语言扩展，能充分利用 rust 生态。
>
> 缺点: webview 每个系统下略有差异，UI细节可能不一致。tauri 推出时间短，生态不如 electron 健全，用 rust 也有较高的学习成本，如果不在乎 size，首推 electron

👇 uapp 基于 Electron 桌面应用案例

![electron demo](https://uappx.oss-cn-hangzhou.aliyuncs.com/repo/electron.gif)

---

## uapp 使用帮助

见 [doc/help.txt](doc/help.txt)

### 全局配置

```bash
uapp config set hbx.dir "/Applications/HBuilderX.app"
uapp config get hbx.dir
uapp config list
uapp config delete hbx.dir
```

配置保存到 `~/.uappsdk/config.json`，无需先执行 `uapp sdk init`。`get` 只输出已保存的值，未配置时返回非零退出码；`list`（或直接 `uapp config`）以 JSON 输出已保存配置。删除不存在的配置不报错。

| 配置项 | 值的要求 |
|:------|:--------|
| `hbx.dir`、`wx.dir` | 已存在的安装目录 |
| `node` | 已存在的程序文件 |

路径支持相对路径和 `~/`，保存时转为绝对路径，含空格的路径需加引号。未知配置项、缺少或多余参数、非法值会报错，且不会修改配置文件。

查询不包含运行时自动探测的默认路径；`delete` 仅移除显式配置，后续运行仍会使用已有的默认探测逻辑。旧写法 `uapp config <key> <value>` 继续支持；**`uapp config <key>` 现在查询，不再删除**，删除请明确使用 `delete`。

## License

The Apache License 2. Please see [License File](LICENSE.md) for more information.

## 联系作者

如果你在使用 uapp 中，遇到问题，或有改进建议，欢迎联系

+作者vx: 28451307
