# uapp iOS 离线工程模板（fork 内置版）

基于官方模板 + 实战修复沉淀，修复项：

- 三个 target 均已定义 `scheme: {}`（xcodegen 生成后命令行 `-scheme` 可直接用）
- 自带 `config/export_release.plist`（`uapp run build:app-plus release` 需要）
- `uapp add ios` 会自动创建 `manifest.json -> ../manifest.json` 软链和 `SDKs/SDK` 软链

## 快速开始（新项目）

```bash
uapp sdk init        # 同步本模板到 ~/.uappsdk/templates/ios
uapp add ios         # 在 webapp 根目录执行, 生成本地模板工程
```

## 签名占位符（生成后必须改）

所有 `YOUR_DEVELOPMENT_TEAM` / `uapp-dev` / `uapp-release` / `com.example.uapp` 都是占位符：

| 文件 | 要改的值 |
|---|---|
| `config/base.yml` | 一般不用改（prepare 会从 manifest 同步版本号/应用名） |
| `config/uapp_dev.yml` / `uapp_test.yml` | `DEVELOPMENT_TEAM`、`PROVISIONING_PROFILE_SPECIFIER`（`PRODUCT_BUNDLE_IDENTIFIER` 由 prepare 从 manifest 写入，不用改） |
| `config/uapp_release.yml` | `DEVELOPMENT_TEAM`、`PROVISIONING_PROFILE_SPECIFIER` |
| `config/export_test.plist` | `teamID`、provisioningProfiles 的 profile 名（bundle id 由 prepare 写入） |
| `config/export_release.plist` | `teamID`、provisioningProfiles 的 profile 名、`method` |

profile 提前装好：p12 导入钥匙串 + `.mobileprovision` 拷到
`~/Library/MobileDevice/Provisioning Profiles/`。

## 打包命令

```bash
uapp run build:app-plus base      # 真机自定义基座 (HBuilderX 运行到 iOS 真机)
uapp run build:app-plus test      # 测试包 (export_test.plist)
uapp run build:app-plus sim       # iOS 模拟器包 (x86_64)
uapp run build:app-plus release   # release 发布包 (export_release.plist)
```

> 打 release 建议 `DEVELOPER_DIR=/Applications/Xcode-26.x.app/Contents/Developer`
> （正式版 Xcode），beta 版 Xcode 编出的包 App Store 拒收。

## 已知约定

- 包名（`PRODUCT_BUNDLE_IDENTIFIER`）由 prepare 按构建类型从
  `uapp.ios.{base|test|sim|release}.package` 写入对应 target yml，导出 plist 的
  `provisioningProfiles` key 同步写成该包名；release 包名必须与 DCloud key
  申请时的包名一致，否则 appkey 校验失败
- test / sim 未填的字段回退 `uapp.ios.base`，base / release 必填
- 旧的 `uapp["ios.package"]` / `uapp["ios.appkey"]` 已废弃，不再读取
- iOS 权限文案由 `app-plus.distribute.ios.privacyDescription` 同步：键名即 Info.plist
  键名（如 `NSCameraUsageDescription`），打包时写入本次构建类型的 Info.plist
  （base/test/sim → `AppDev/Info.plist`，release → `AppRelease/Info.plist`），
  已有键覆盖、模板里没有的键自动插入；值不做国际化展开
- URL Scheme / 白名单 / Google 登录也按标准字段同步：`ios.urltypes` →
  `CFBundleURLName=scheme` 的 schemes、`ios.urlschemewhitelist` →
  `LSApplicationQueriesSchemes`、`sdkConfigs.oauth.google.clientid` → `GIDClientID`（原值）
  + `google_url`（倒序）；没配置时保留模板原值，模板缺键会自动补齐
- 多语言：manifest 根节点 `locale` / `fallbackLocale` + `locale/*.json` 汇总写入 `CFBundleLocalizations`，
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
  声明的参数键一律写入，值为空时写空字符串并告警，因为 SDK 靠键是否存在判断是否集成），
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
- 改过 `config/*.yml` 后必须 `xcodegen generate`
