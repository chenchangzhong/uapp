# uapp iOS 离线工程模板（fork 内置版）

基于官方模板 + 实战修复沉淀，修复项：

- 三个 target 均已定义 `scheme: {}`（xcodegen 生成后命令行 `-scheme` 可直接用）
- 自带 `config/export_release.plist`（`uapp run build:app-plus release` 需要）
- `uapp add ios` 会自动创建 `manifest.json -> ../manifest.json` 软链和 `SDKs/SDK` 软链

## 快速开始（新项目）

```bash
brew install cocoapods   # 依赖统一由 SDK 里的 uniapp.podspec 提供
uapp sdk init            # 同步本模板到 ~/.uappsdk/templates/ios
uapp add ios             # 在 webapp 根目录执行, 生成本地模板工程
```

工程结构仍由 XcodeGen 生成，SDK 与三方库依赖全部交给 CocoaPods（`uapp prepare` 会生成 `Podfile` 并把
`config/base.yml` 就地改成 Pod 版，`uapp run build:app-plus ...` 会自动 `xcodegen` + `pod install`）。

## 权限与 capability（entitlements）

`HBuilder.entitlements` / `uapp-test.entitlements` / `uapp-release.entitlements` 由 `config/uapp_*.yml` 的
`entitlements.properties` 生成，每次 `xcodegen` 都会重写 —— 加能力（App Groups、Associated Domains、Push 环境等）
请改对应 yml 的 properties，不要直接改这三个文件。

## 签名占位符（生成后必须改）

所有 `YOUR_DEVELOPMENT_TEAM` / `uapp-dev` / `uapp-release` / `com.example.uapp` 都是占位符：

| 文件 | 要改的值 |
|---|---|
| `config/base.yml` | 一般不用改（prepare 会从 manifest 同步版本号/应用名） |
| `config/uapp_dev.yml` / `uapp_test.yml` | `DEVELOPMENT_TEAM`、`PROVISIONING_PROFILE_SPECIFIER`（`PRODUCT_BUNDLE_IDENTIFIER` 由 prepare 从 manifest 写入，不用改） |
| `config/uapp_release.yml` | `DEVELOPMENT_TEAM`、`PROVISIONING_PROFILE_SPECIFIER` |
| `config/export_dev.plist` / `export_release.plist` / `export_test.plist` | 按需改 `method`（App Store / ad-hoc / enterprise）。`teamID`、`signingCertificate`、provisioningProfiles 的包名与 profile 名均由 prepare 从对应 `uapp_*.yml` 同步，**不用手改**。`export_test.plist` 只在 `uapp.ios.test.export=own` 时使用 |

profile 提前装好：p12 导入钥匙串 + `.mobileprovision` 拷到
`~/Library/MobileDevice/Provisioning Profiles/`。

## 打包命令

```bash
uapp run build:app-plus base      # 真机自定义基座 (HBuilderX 运行到 iOS 真机)
uapp run build:app-plus test      # 测试包 (默认共用 export_dev.plist)
uapp run build:app-plus sim       # iOS 模拟器包 (x86_64)
uapp run build:app-plus release   # release 发布包 (export_release.plist)
```

> 打 release 建议 `DEVELOPER_DIR=/Applications/Xcode-26.x.app/Contents/Developer`
> （正式版 Xcode），beta 版 Xcode 编出的包 App Store 拒收。

## 右缘返回（RTL，可选，默认关）

面向中东等从右向左阅读习惯的 App：返回手势应挂在屏幕右缘。DCloud 原生侧滑返回是自建手势
`H5CoreScreenEdgePan`，edges 创建时锁死 Left，官方 `popGesture` / pages.json 均无方向配置；
模板在 `Main/AppDelegate.m` 内置了一套自研右缘返回实现，默认关闭，要点：

- 拦截 `UIView -addGestureRecognizer:`（method swizzle）：DCloud 左缘识别器加入即被摘除。
  必须在 PDRCore init 前安装，`didFinishLaunchingWithOptions` 里已就位
- 自建右缘 `UIScreenEdgePanGestureRecognizer` 挂在 `windowManager.superview`；
  命中条件：可见 frame ≥ 2、非 tab 根页、`popGesture` 不为 none/skip
- 交互：当前页跟手左移 + 下层页 1/3 视差 + 压暗与右缘投影；位移超 30% 屏宽或松手速度够快
  → 滑出后 `uni.navigateBack()`，否则回弹
- 子开关在 AppDelegate.m 顶部就地改：`RTL_EDGE_BACK_FOLLOW`（跟手位移，关则只做阈值判定）、
  `RTL_DUMP_SELECTORS`（SDK 升级排查用，dump PDRCore 相关类的方法名）

启用方式二选一：

1. `config/custom.yml` 把 `uAppBase: {}` 替换成（`GCC_PREPROCESSOR_DEFINITIONS` 会整体覆盖
   base.yml 的同名值，必须带上其现有宏；该文件注释里有现成示例）：

   ```yaml
   targetTemplates:
       uAppBase:
           settings:
               GCC_PREPROCESSOR_DEFINITIONS: '$(inherited) PDR_PLUS_MAP PDR_PLUS_GETUI PDR_PLUS_UMEN RTL_EDGE_BACK=1'
   ```

2. 直接把 `Main/AppDelegate.m` 里 `#ifndef RTL_EDGE_BACK` 块的默认值改成 1。

已知限制（DCloud SDK 升级后需真机回归）：

- `popGesture` / `isScreenEdgePanSkip` 是未公开 selector，升级后先验证 popGesture:none 页
  （禁返回页）与新页面类型是否仍被正确拦截——selector 失效时的退化方向是「放行」
- `addGestureRecognizer:` 的交换全 App 生效，将来要加左缘侧滑抽屉等手势需在拦截器里加白名单
- 返回动画是「先隐藏当前页再 `uni.navigateBack()`」，避免与 webview 自身转场叠成双动画
- 真机验证清单：普通页返回、tab 根页（不可滑）、popGesture:none 页（不可滑）、新开页后返回、
  动画过程中连续滑、快速连续返回

## 已知约定

- 包名（`PRODUCT_BUNDLE_IDENTIFIER`）由 prepare 按构建类型从
  `uapp.ios.{base|test|sim|release}.package` 写入对应 target yml，导出 plist 的
  `provisioningProfiles` key 同步写成该包名；release 包名必须与 DCloud key
  申请时的包名一致，否则 appkey 校验失败
- test / sim 未填的字段回退 `uapp.ios.base`，base / release 必填
- test 的导出配置由 `uapp.ios.test.export` 决定，签名值始终取自 `uapp_test.yml`：
  - `dev`（默认）：与 base 同为开发签名，共用 `config/export_dev.plist`
  - `release`：与正式包同一种导出方式，共用 `config/export_release.plist`
  - `own`：用本工程的 `config/export_test.plist`。测试包要 ad-hoc、正式包要
    App Store 时两者的 `method` 不同，只能走这个值（把 `export_test.plist` 的
    `method` 改成 `ad-hoc`）；文件不存在时 prepare 会报错提示从 `export_dev.plist`
    复制一份
- 旧的 `uapp["ios.package"]` / `uapp["ios.appkey"]` 已废弃，不再读取
- iOS 权限文案由 `app-plus.distribute.ios.privacyDescription` 同步：键名即 Info.plist
  键名（如 `NSCameraUsageDescription`），打包时写入本次构建类型的 Info.plist
  （base/test/sim → `AppDev/Info.plist`，release → `AppRelease/Info.plist`），
  已有键覆盖、模板里没有的键自动插入；值不做国际化展开
- URL Scheme / 白名单 / Google 登录也按标准字段同步：`ios.urltypes` →
  `CFBundleURLName=scheme` 的 schemes、`ios.urlschemewhitelist` →
  `LSApplicationQueriesSchemes`、`sdkConfigs.oauth.google.clientid` → `GIDClientID`（原值）
  + `google_url`（倒序）；测试包可在 `uapp.ios.test.googleClientId` 单独配一个 client id
  （Google 的 iOS client id 绑定 bundle id，正式包沿用标准字段）；没配置时保留模板原值，模板缺键会自动补齐
- 多语言：manifest 根节点 `locale` / `fallbackLocale` 写入 `CFBundleLocalizations`（只认 manifest，不扫描 `locale/` 目录），
  否则 iOS 只认 `CFBundleDevelopmentRegion`，应用内语言不跟随系统；`CFBundleDevelopmentRegion`
  跟随 `fallbackLocale`（兜底语言必须是支持列表里的一种）
- 屏幕方向：`app-plus.screenOrientation` 写入本次构建类型 Info.plist 的
  `UISupportedInterfaceOrientations` 与 `~ipad`（portrait-primary/secondary、landscape-primary/secondary
  依次映射到 Portrait/PortraitUpsideDown/LandscapeLeft/LandscapeRight）；不配置时保留模板的四方向
- 微信登录的 Info.plist 同步（`UniversalLinks` / `weixin` appid / appSecret / URL scheme 四项）
  目前是**空操作**：模板 `Info.plist` 里没有这些键，正则匹配不到。暂不处理，等模板补齐 plist 键后再启用
- 原生插件（`app-plus.nativePlugins`）按 `nativeplugins/<插件标识>/package.json` 的
  `_dp_nativeplugin.ios` 同步：`dcloud_uniplugins` 按 `hooksClass` + `plugins` 整段重写（离线打包的插件
  注册表，必须与 manifest 的 `nativePlugins` 一致，过期注册会被移除并提示）；`plists` / `capabilities.plists` / `parameters` 写进本次构建类型的
  Info.plist（参数定义在 package.json 没声明时回退 manifest 的 `__plugin_info__.parameters`；
  参数没填（或解析后为空）时不写占位键，只告警提示插件可能未生效），
  `frameworks` / `resources` / `assets` 写进 `config/custom.yml` 的
  `targetTemplates.uAppBase`（`# >>> uapp nativeplugins` 标记块，每次构建整块重写，插件全关时还原
  `uAppBase: {}`）；`base.yml` 已有的系统库不会重复写（重复依赖会让 xcodegen 丢掉其他 framework）
- 开屏 storyboard 的应用名不再由 uapp 改写（`replaceStoryboard` 已移除），需要改名请直接改
  `Main/Resources/LaunchScreen.storyboard` / `LaunchScreenAD.storyboard`
- `uapp sdk init` 是合并同步（只增不删）：模板里**删除**的文件不会自动从
  `~/.uappsdk/templates/ios` 消失，改模板删文件后需手动
  `rm -rf ~/.uappsdk/templates/ios && uapp sdk init`
- `manifest.json` 必须保持软链指向根 manifest.json（`uapp add ios` 自动创建，勿复制成真实文件）
- `ios/SDKs/SDK` 是指向 `~/.uappsdk/ios/SDK` 的软链（缺失时 uapp prepare 会自动创建）
- Xcode 27+ 已移除 `UIAccelerometer`：base.yml 勿加回 `liblibAccelerometer.a` / `liblibPGProximity.a`
- `liblibOrientation.a` / `DCUniRecord.framework` 勿移除（运行时引用）
- deployment target 15.0 勿改回 13.0
- 改过 `config/*.yml` 后必须 `xcodegen generate`（命令行打包时 `uapp run build:app-plus` 会自动执行）
- 依赖只走 Pod：`config/base.yml` 与三个 flavor 文件里 `SDKs/SDK/**` 的手写条目都会被 prepare 删掉，模块需要什么库由 manifest 的
  `app-plus.modules` 映射成 subspec；要加用户自己的库请写 `config/custom.yml`
- `config/base.yml` 不再手写任何依赖（`libicucore.tbd` 也删了：podspec 与官方示例工程都没引用它，实测构建不需要）；
  系统库全部由对应 subspec 提供，需要额外库时写进 `config/custom.yml`
