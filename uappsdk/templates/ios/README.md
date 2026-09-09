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
| `config/uapp_dev.yml` / `uapp_test.yml` | `PRODUCT_BUNDLE_IDENTIFIER`、`DEVELOPMENT_TEAM`、`PROVISIONING_PROFILE_SPECIFIER` |
| `config/uapp_release.yml` | `PRODUCT_BUNDLE_IDENTIFIER`（须与 manifest 的 ios.package 一致）、`DEVELOPMENT_TEAM`、`PROVISIONING_PROFILE_SPECIFIER` |
| `config/export_test.plist` | `teamID`、provisioningProfiles 两处 |
| `config/export_release.plist` | `teamID`、provisioningProfiles 两处、`method` |

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

- 包名（`PRODUCT_BUNDLE_IDENTIFIER`）分环境配置在三个 target yml，manifest 的
  `ios.package` 不再自动流入构建；release 包名必须与 manifest 的 `ios.package`
  （DCloud key 申请包名）一致，否则 appkey 校验失败
- `uapp sdk init` 是合并同步（只增不删）：模板里**删除**的文件不会自动从
  `~/.uappsdk/templates/ios` 消失，改模板删文件后需手动
  `rm -rf ~/.uappsdk/templates/ios && uapp sdk init`
- `manifest.json` 必须保持软链指向根 manifest.json（`uapp add ios` 自动创建，勿复制成真实文件）
- `ios/SDKs/SDK` 是指向 `~/.uappsdk/ios/SDK` 的软链（缺失时 uapp prepare 会自动创建）
- Xcode 27+ 已移除 `UIAccelerometer`：base.yml 勿加回 `liblibAccelerometer.a` / `liblibPGProximity.a`
- `liblibOrientation.a` / `DCUniRecord.framework` 勿移除（运行时引用）
- deployment target 15.0 勿改回 13.0
- 改过 `config/*.yml` 后必须 `xcodegen generate`
