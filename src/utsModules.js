// UTS 插件自动集成
//
// 触发条件: webapp 的 uni_modules/ 与 unpackage/resources/uni_modules/ 同时存在时,
// 按 unpackage/resources/uni_modules/<id>/utssdk/<platform>/ 下的编译产物集成:
// - android: 生成 uniplugin_<id> library 模块, 接线 settings.gradle / build.gradle
//            模块内写入同步账本 .uapp-uts.json, 之后按账本增量刷新; 用户手改过的模块保持不动
// - ios:     扫 utsplugins/<id>/ 下编译好的 framework, 写入 config/custom.yml
//
// 只处理「源码里还在」的插件: 导出目录有、uni_modules 源码没有的残留只警告不集成。

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const EXPORT_DIR = path.join('unpackage', 'resources', 'uni_modules')

// app/build.gradle 里的块标记, 与原生插件一样只认带后缀的, 避免把用户手写的同名块当成自己的
// 结尾 $\n? 把块后的换行一起吃掉, 保证清块后重建的内容与上轮完全一致
const UAPP_UTS_BLOCK = /^[ \t]*\/\/ UTS插件(.+?)所需库-开始 \(自动生成, 勿手改\)\r?\n([\s\S]*?)^[ \t]*\/\/ UTS插件\1所需库-结束[ \t]*\r?$\n?/gm
const UTS_MARK_START = (id) => `// UTS插件${id}所需库-开始 (自动生成, 勿手改)`
const UTS_MARK_END = (id) => `// UTS插件${id}所需库-结束`

// settings.gradle 里的 include 块标记
const UAPP_UTS_SETTINGS_BLOCK = /^[ \t]*\/\/ UTS插件模块-开始 \(自动生成, 勿手改\)\r?\n([\s\S]*?)^[ \t]*\/\/ UTS插件模块-结束[ \t]*\r?$\n?/gm
const UTS_SETTINGS_MARK_START = '// UTS插件模块-开始 (自动生成, 勿手改)'
const UTS_SETTINGS_MARK_END = '// UTS插件模块-结束'

// UTS 插件运行时需要的公共依赖, 所有插件共用一份
const UTS_BASE_DEPS = [
  'implementation "org.jetbrains.kotlin:kotlin-stdlib:2.2.0"',
  'implementation "org.jetbrains.kotlin:kotlin-reflect:2.2.0"',
  'implementation "org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1"',
  'implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1"',
  'implementation "com.github.getActivity:XXPermissions:18.63"'
]

// 模块 build.gradle 固定的 compileOnly 依赖(utsplugin-release.aar 通过 user.home 下的 SDK libs 引入)
const UTS_MODULE_DEPS = [
  "compileOnly fileTree(include: ['*.aar'], dir: System.getProperty(\"user.home\") + '/.uappsdk/android/SDK/libs')",
  "compileOnly 'com.alibaba:fastjson:1.1.46.android'",
  "compileOnly 'org.jetbrains.kotlin:kotlin-stdlib:2.2.0'",
  "compileOnly 'androidx.core:core-ktx:1.9.0'",
  "compileOnly 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:2.2.0'",
  "compileOnly 'org.jetbrains.kotlin:kotlin-reflect:2.2.0'",
  "compileOnly 'org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1'",
  "compileOnly 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1'"
]

const utsModuleName = (id) => 'uniplugin_' + id.replace(/-/g, '')

// 统计一行里 {} 的增量, 字符串字面量与注释里的不算
function braceDelta(line) {
  let delta = 0
  let inString = false
  let stringChar = ''
  let inComment = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inComment) continue
    if (inString) {
      if (char === '\\') { i++; continue }
      if (char === stringChar) inString = false
      continue
    }
    if (char === '/' && line[i + 1] === '/') break
    if (char === "'" || char === '"') { inString = true; stringChar = char; continue }
    if (char === '{') delta++
    else if (char === '}') delta--
  }
  return delta
}

// 从配置依赖行里取 maven 坐标, 用于判断工程里是否已有同坐标依赖
function coordOf(line) {
  const match = /['"]([^'":]+:[^'":]+:[^'"]+)['"]/.exec(line)
  return match ? match[1] : null
}

function detectEol(content) {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

// 把块标记连内容一起清掉, 只剩用户自己写的内容
function stripUtsBlocks(content, blockRegex) {
  return content.replace(blockRegex, '')
}

// 读取导出产物里的 config.json, 解析失败按空配置处理
function readUtsConfig(platformDir) {
  const file = path.join(platformDir, 'config.json')
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return { __invalid: true }
  }
}

// 触发条件与交集: 两个目录都在才有 UTS 插件要集成
export function listUtsPlugins({ webAppDir }) {
  const result = { android: [], ios: [], warnings: [] }
  const sourceDir = path.join(webAppDir, 'uni_modules')
  const exportDir = path.join(webAppDir, EXPORT_DIR)
  if (!fs.existsSync(sourceDir) || !fs.existsSync(exportDir)) return result

  for (const id of fs.readdirSync(exportDir).sort()) {
    const exported = path.join(exportDir, id, 'utssdk')
    if (!fs.existsSync(exported)) continue
    if (!fs.existsSync(path.join(sourceDir, id, 'utssdk'))) {
      result.warnings.push(`UTS插件 ${id}: unpackage/resources/uni_modules 里有导出产物, 但源码 uni_modules/${id} 已不存在, 跳过集成 (请清理导出残留)`)
      continue
    }
    for (const platform of ['app-android', 'app-ios']) {
      const platformDir = path.join(exported, platform)
      if (!fs.existsSync(platformDir)) continue
      const config = readUtsConfig(platformDir)
      if (config.__invalid) result.warnings.push(`UTS插件 ${id}: ${platform} 的 config.json 不是合法 JSON, 按空配置集成`)
      const plugin = { id, platformDir, config }
      if (platform === 'app-android') result.android.push(plugin)
      else result.ios.push(plugin)
    }
  }
  return result
}

// config.json 的 dependencies 支持 "group:artifact:ver" 字符串, 或 { id, source } 对象 (source 原样写入)
function androidConfigDeps(config) {
  const deps = []
  for (const dep of config.dependencies || []) {
    if (typeof dep === 'string') deps.push(`implementation '${dep}'`)
    else if (dep && typeof dep.source === 'string') deps.push(dep.source)
  }
  return deps
}

// 导出产物的 src/ 映射到模块目录:
// - rel 以 src/ 开头的, 本身就是模块内相对路径, 原样落
// - 根级文件按文件头 package 声明落 src/main/java/<包路径>/<文件名>
function mapSourceFile(rel, content, id) {
  if (rel.startsWith('src/')) return rel
  const packageMatch = /^package\s+([\w.]+)/m.exec(content)
  if (packageMatch) {
    return path.join('src/main/java', ...packageMatch[1].split('.'), path.basename(rel))
  }
  // 拿不到 package 声明时按 uts 约定兜底: uts.sdk.modules.<驼峰id>
  const camel = id.replace(/-(\w)/g, (m, c) => c.toUpperCase())
  return path.join('src/main/java', 'uts', 'sdk', 'modules', camel, path.basename(rel))
}

function writeIfChanged(file, content) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
}

function moduleBuildGradle({ moduleName, compileSdk, minSdk, abiFilters, extraDeps, hasLibs }) {
  const deps = [...UTS_MODULE_DEPS]
  if (hasLibs) deps.push(`compileOnly fileTree(include: ['*.aar'], dir: 'libs')`)
  deps.push(...extraDeps)
  return `apply plugin: 'com.android.library'
apply plugin: 'org.jetbrains.kotlin.android'

android {
    namespace 'com.example.${moduleName}'
    compileSdk ${compileSdk}

    defaultConfig {
        minSdk ${minSdk}
        consumerProguardFiles "consumer-rules.pro"
${abiFilters ? `
        ndk {
            abiFilters ${abiFilters}
        }
` : ''}    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_11
        targetCompatibility JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = '11'
    }
}

dependencies {
${deps.map((dep) => `    ${dep}`).join('\n')}
}
`
}

// 模块内的同步账本: 记录每个由 uapp 生成/同步的文件及其 sha1, 用于增量刷新与手改检测。
// 账本和模块里的 build.gradle 一样属于工程状态, 不写进 .gitignore, 随工程一起入库,
// 否则新 clone 的机器上模块有 build.gradle 却没有账本, 会被当成手工模块永久跳过刷新。
const UTS_LEDGER = '.uapp-uts.json'
// 生成物但用户通常会自己追加内容的文件: 手改后保留用户版本, 不因此冻结整个模块
const UTS_SHARED_FILES = new Set(['.gitignore', 'proguard-rules.pro', 'consumer-rules.pro'])

function sha1Of(content) {
  return crypto.createHash('sha1').update(content).digest('hex')
}

// 递归列出一级目录下所有文件 (相对路径)
function listFiles(root) {
  const files = []
  const walk = (rel) => {
    const from = path.join(root, rel)
    if (fs.statSync(from).isDirectory()) {
      for (const name of fs.readdirSync(from)) walk(path.join(rel, name))
      return
    }
    files.push(rel)
  }
  if (fs.existsSync(root)) for (const name of fs.readdirSync(root)) walk(name)
  return files
}

function emptyPluginManifest() {
  return '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" />\n'
}

// 插件自带的 AndroidManifest.xml: 保留权限与组件声明。
// AGP 8 起 manifest 不再允许 package 属性 (namespace 在 build.gradle 里声明), 相对类名
// (android:name=".Foo") 因此失去解析依据, 必须先用 package 展开成全限定名, 再删掉 package 属性。
function pluginManifest({ id, platformDir }) {
  const warnings = []
  const file = path.join(platformDir, 'AndroidManifest.xml')
  if (!fs.existsSync(file)) return { content: emptyPluginManifest(), warnings }
  let xml = fs.readFileSync(file, 'utf8')
  const pkgMatch = /\s+package\s*=\s*("[^"]*"|'[^']*')/.exec(xml)
  const packageName = pkgMatch ? pkgMatch[1].slice(1, -1) : ''
  let unresolved = false
  xml = xml.replace(/android:(?:name|targetActivity|parentActivityName)\s*=\s*("[^"]*"|'[^']*')/g, (all, quoted) => {
    const quote = quoted[0]
    const value = quoted.slice(1, -1)
    if (!value.startsWith('.')) return all
    if (!packageName) {
      unresolved = true
      return all
    }
    return all.replace(quoted, `${quote}${packageName}${value}${quote}`)
  })
  // tools: 属性必须自己声明命名空间, 否则合并时报错; 这种 manifest 回退成空 manifest 更安全
  if (/\stools:[\w-]+\s*=/.test(xml) && !/xmlns:tools\s*=/.test(xml)) {
    warnings.push(`UTS插件 ${id}: 导出产物里的 AndroidManifest.xml 使用了未声明 xmlns:tools 的 tools: 属性, 已跳过该 manifest`)
    return { content: emptyPluginManifest(), warnings }
  }
  if (unresolved) {
    warnings.push(`UTS插件 ${id}: 导出产物里的 AndroidManifest.xml 有相对类名但缺少 package 属性, 无法展开, 已跳过该 manifest`)
    return { content: emptyPluginManifest(), warnings }
  }
  xml = xml.replace(/\s+package\s*=\s*("[^"]*"|'[^']*')/, '')
  if (/\s+package\s*=/.test(xml)) {
    warnings.push(`UTS插件 ${id}: 导出产物里的 AndroidManifest.xml 的 package 属性未能移除, 已跳过该 manifest`)
    return { content: emptyPluginManifest(), warnings }
  }
  return { content: xml, warnings }
}

// 模块内要生成/同步的文件: content 为生成内容, copyFrom 为导出产物里的源文件
function planUtsModule({ id, platformDir, config, compileSdk, abiFilters, moduleName }) {
  const files = []
  const warnings = []
  const addContent = (rel, content) => files.push({ rel, content: Buffer.from(content) })
  const addCopy = (rel, from) => files.push({ rel, copyFrom: from })

  const hasLibs = fs.existsSync(path.join(platformDir, 'libs')) && fs.readdirSync(path.join(platformDir, 'libs')).length > 0
  addContent('.gitignore', '/build\n')
  addContent('build.gradle', moduleBuildGradle({
    moduleName,
    compileSdk,
    minSdk: config.minSdkVersion || 21,
    abiFilters: (config.abis && config.abis.length) ? config.abis.map((abi) => `"${abi}"`).join(', ') : abiFilters,
    extraDeps: androidConfigDeps(config).map((dep) => dep.replace(/^implementation\b/, 'compileOnly')),
    hasLibs
  }))
  addContent('proguard-rules.pro', '')
  addContent('consumer-rules.pro', '')
  const manifest = pluginManifest({ id, platformDir })
  warnings.push(...manifest.warnings)
  addContent('src/main/AndroidManifest.xml', manifest.content)

  // 源码: src/ 下的文件按映射规则逐个落位
  const srcDir = path.join(platformDir, 'src')
  for (const rel of listFiles(srcDir)) {
    addCopy(mapSourceFile(rel, fs.readFileSync(path.join(srcDir, rel), 'utf8'), id), path.join(srcDir, rel))
  }
  for (const dir of ['assets', 'res']) {
    const from = path.join(platformDir, dir)
    for (const rel of listFiles(from)) addCopy(path.join('src/main', dir, rel), path.join(from, rel))
  }
  const libsDir = path.join(platformDir, 'libs')
  for (const rel of listFiles(libsDir)) addCopy(path.join('libs', rel), path.join(libsDir, rel))
  if (listFiles(libsDir).some((rel) => rel.toLowerCase().endsWith('.jar'))) {
    warnings.push(`UTS插件 ${id}: libs 里有 jar, 会被打进 apk, 若与宿主已有依赖同名会在打包时报重复类`)
  }
  return { files, warnings }
}

// 账本三态: missing(没有) / invalid(损坏) / ok
function readLedger(moduleDir) {
  const file = path.join(moduleDir, UTS_LEDGER)
  if (!fs.existsSync(file)) return { state: 'missing' }
  let ledger
  try {
    ledger = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return { state: 'invalid', reason: 'JSON 解析失败' }
  }
  if (!ledger || typeof ledger.id !== 'string' || !ledger.id || !ledger.files || typeof ledger.files !== 'object') {
    return { state: 'invalid', reason: '缺少 id 或 files' }
  }
  for (const rel of Object.keys(ledger.files)) {
    // 账本可手改, 非法路径 (绝对路径/..) 一律视为损坏, 避免误删模块外的文件
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
      return { state: 'invalid', reason: `路径越界: ${rel}` }
    }
  }
  return { state: 'ok', ledger }
}

// 旧模块 (有 build.gradle 无账本) 的收编: 计划里的文件全部与磁盘一致 (或尚未生成) 才认领,
// 认领后就能正常增量刷新; 有任何不一致仍按手工模块跳过。
// .gitignore / *.pro 属于共享文件, 用户改过不算不一致, 收编时记入 retained 继续保留
function adoptUtsModuleDir({ moduleDir, files }) {
  const retained = []
  for (const file of files) {
    const target = path.join(moduleDir, file.rel)
    if (!fs.existsSync(target)) continue
    const content = file.copyFrom ? fs.readFileSync(file.copyFrom) : file.content
    if (fs.readFileSync(target).equals(content)) continue
    if (UTS_SHARED_FILES.has(file.rel)) {
      retained.push(file.rel)
      continue
    }
    return null
  }
  return { retained }
}

// 按计划同步模块目录: 只覆盖「账本记录且内容未被手改」的文件, 手改过就整块跳过。
// .gitignore / *.pro 是用户会自己追加内容的共享文件: 手改后保留用户版本, 不冻结整个模块
function syncUtsModuleDir({ id, moduleDir, files, ledger }) {
  const known = ledger ? ledger.files : {}
  // 被用户改过并保留的共享文件 (.gitignore / *.pro): 之后每轮都不再覆盖
  const retained = new Set((ledger && ledger.retained) || [])
  const planned = new Set(files.map((file) => file.rel))
  const warnings = []
  const conflicts = []
  for (const rel of Object.keys(known)) {
    if (UTS_SHARED_FILES.has(rel)) continue
    const target = path.join(moduleDir, rel)
    if (fs.existsSync(target) && sha1Of(fs.readFileSync(target)) !== known[rel]) conflicts.push(rel)
  }
  if (conflicts.length) return { conflicts, warnings }

  const changed = []
  const next = {}
  for (const file of files) {
    const target = path.join(moduleDir, file.rel)
    const content = file.copyFrom ? fs.readFileSync(file.copyFrom) : file.content
    const exists = fs.existsSync(target)
    const current = exists ? fs.readFileSync(target) : null
    const same = Boolean(current) && current.equals(content)
    const shared = UTS_SHARED_FILES.has(file.rel)
    const touched = exists && !same && Boolean(known[file.rel]) && sha1Of(current) !== known[file.rel]
    if (shared && exists && !same && (touched || retained.has(file.rel))) {
      retained.add(file.rel)
      next[file.rel] = sha1Of(current)
      warnings.push(`已保留模块内自定义的 ${file.rel}`)
      continue
    }
    if (!same) {
      if (exists && !known[file.rel]) warnings.push(`已覆盖模块内同名文件 ${file.rel}`)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content)
      changed.push(file.rel)
    }
    if (same && retained.has(file.rel)) retained.delete(file.rel)
    next[file.rel] = sha1Of(content)
  }
  // 账本里有、这次不再产出的文件: 只有内容未被手改时才删
  for (const rel of Object.keys(known)) {
    if (planned.has(rel)) continue
    fs.rmSync(path.join(moduleDir, rel), { force: true })
    changed.push(rel)
  }
  const payload = { id, files: next }
  if (retained.size) payload.retained = [...retained].sort()
  writeIfChanged(path.join(moduleDir, UTS_LEDGER), JSON.stringify(payload, null, 2) + '\n')
  return { changed, warnings }
}

// 生成或刷新 uniplugin_<id> 模块目录
function scaffoldUtsModule({ appDir, id, platformDir, config, compileSdk, abiFilters }) {
  const moduleName = utsModuleName(id)
  const moduleDir = path.join(appDir, moduleName)
  const hasGradle = fs.existsSync(path.join(moduleDir, 'build.gradle'))
  // 只剩 build/ 编译残留的目录不能跳过, 否则 settings.gradle 会 include 一个没有构建脚本的模块,
  // gradle 配置阶段就报错
  const residual = !hasGradle && fs.existsSync(moduleDir)
  const { state, ledger, reason } = readLedger(moduleDir)
  if (state === 'invalid') return { status: 'legacy', reason, residual }
  // 模块名是插件 id 去掉横线, 不同 id 可能撞名; 不覆盖别的插件生成的模块
  if (state === 'ok' && ledger.id !== id) return { status: 'owner', owner: ledger.id, residual }

  const plan = planUtsModule({ id, platformDir, config, compileSdk, abiFilters, moduleName })
  const warnings = [...plan.warnings]
  // 有构建脚本但没有账本: 内容一致就收编, 对不上就按旧版本/手工模块保持原样
  let adopted = null
  if (state === 'missing' && hasGradle) {
    adopted = adoptUtsModuleDir({ moduleDir, files: plan.files })
    if (!adopted) return { status: 'legacy', residual, warnings }
  }
  const base = state === 'ok' ? ledger : (adopted ? { id, files: {}, retained: adopted.retained } : null)
  const sync = syncUtsModuleDir({ id, moduleDir, files: plan.files, ledger: base })
  warnings.push(...sync.warnings)
  if (sync.conflicts) return { status: 'conflict', conflicts: sync.conflicts, residual, warnings }
  if (!hasGradle) return { status: 'created', residual, warnings }
  return { status: sync.changed.length ? 'updated' : 'unchanged', residual, warnings }
}

// settings.gradle: include 行放进自己的标记块, 对 plain 已有的 include 去重
function updateSettingsGradle({ appDir, moduleNames }) {
  const file = path.join(appDir, 'settings.gradle')
  if (!fs.existsSync(file)) return { warnings: [], changed: false }
  const raw = fs.readFileSync(file, 'utf8')
  const eol = detectEol(raw)
  const plain = stripUtsBlocks(raw, UAPP_UTS_SETTINGS_BLOCK)

  const existingIncludes = new Set()
  for (const match of plain.matchAll(/^[ \t]*include\s+(.+)$/gm)) {
    for (const name of match[1].split(',')) {
      // include 写法带不带冒号都等价, 归一化后去重
      existingIncludes.add(name.trim().replace(/^['"]|['"]$/g, '').replace(/^:/, ''))
    }
  }
  const lines = moduleNames
    .filter((name) => !existingIncludes.has(name))
    .map((name) => `include ':${name}'`)

  let content = plain
  if (lines.length) {
    const block = `${UTS_SETTINGS_MARK_START}${eol}${lines.join(eol)}${eol}${UTS_SETTINGS_MARK_END}`
    content = content.replace(/\s*$/, '') + eol + eol + block + eol
  }
  if (content !== raw) {
    fs.writeFileSync(file, content)
    return { warnings: [], changed: true }
  }
  return { warnings: [], changed: false }
}

// 根 build.gradle: 缺 kotlin 插件 classpath 与 jitpack 仓库时补写 (都是幂等安全项, 不做移除)
function updateRootGradle({ appDir, needsJitpack }) {
  const file = path.join(appDir, 'build.gradle')
  const warnings = []
  let classpathAdded = false
  let jitpackAdded = false
  if (!fs.existsSync(file)) return { warnings, classpathAdded, jitpackAdded }
  const raw = fs.readFileSync(file, 'utf8')
  const eol = detectEol(raw)
  const lines = raw.split(eol)

  if (!/kotlin-gradle-plugin/.test(raw)) {
    const index = lines.findLastIndex((line) => /^[ \t]*classpath /.test(line))
    if (index < 0) {
      warnings.push('根 build.gradle 里没有找到 classpath 依赖, 未写入 kotlin-gradle-plugin, 请手动添加 org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.0')
    } else {
      lines.splice(index + 1, 0, `${/^[ \t]*/.exec(lines[index])[0]}classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.0'`)
      classpathAdded = true
    }
  }

  if (needsJitpack && !/jitpack\.io/.test(raw)) {
    // 找 allprojects 块里的 repositories, 把 jitpack 仓库补进去
    const allprojectsIndex = lines.findIndex((line) => /^[ \t]*allprojects\s*\{/.test(line))
    if (allprojectsIndex < 0) {
      warnings.push('根 build.gradle 里没有 allprojects 块, 未写入 jitpack 仓库, 请手动添加 maven { url \'https://jitpack.io\' }')
    } else {
      let depth = 0
      let reposIndex = -1
      for (let i = allprojectsIndex + 1; i < lines.length; i++) {
        depth += braceDelta(lines[i])
        if (reposIndex < 0 && /^[ \t]*repositories\s*\{/.test(lines[i])) {
          reposIndex = i
          continue
        }
        if (reposIndex >= 0 && depth === 0) {
          const child = lines.slice(reposIndex + 1, i).find((line) => line.trim())
          const indent = child ? /^[ \t]*/.exec(child)[0] : `${/^[ \t]*/.exec(lines[reposIndex])[0]}    `
          lines.splice(i, 0, `${indent}maven { url 'https://jitpack.io' }`)
          jitpackAdded = true
          break
        }
      }
      if (!jitpackAdded) {
        warnings.push('根 build.gradle 的 allprojects.repositories 结构异常, 未写入 jitpack 仓库, 请手动添加 maven { url \'https://jitpack.io\' }')
      }
    }
  }

  const content = lines.join(eol)
  if (content !== raw) fs.writeFileSync(file, content)
  return { warnings, classpathAdded, jitpackAdded }
}

// app/build.gradle: 清掉旧块 → 逐块插入到 dependencies{} 尾部 → 报差异
function applyUtsGradleBlocks(raw, blocks) {
  const eol = detectEol(raw)
  const oldBlocks = []
  const plain = raw.replace(UAPP_UTS_BLOCK, (full, id, content) => {
    oldBlocks.push({ id, content })
    return ''
  })
  const brokenMark = /^[ \t]*\/\/ UTS插件.+?所需库-开始/.test(plain)
  const oldDeps = oldBlocks.flatMap((block) => block.content.split(eol).map((line) => line.trim()).filter(Boolean))

  const lines = plain.split(eol)
  let content = plain
  // 找 dependencies { } 的收尾位置
  let depth = 0
  let inDeps = false
  let openIdx = -1
  let closeIdx = -1
  let depsSkipped = !blocks.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    depth += braceDelta(line)
    if (!inDeps && /^[ \t]*dependencies\s*\{/.test(line)) {
      inDeps = true
      openIdx = i
      depsSkipped = false
      continue
    }
    if (inDeps && depth === 0 && closeIdx < 0) {
      closeIdx = i
      break
    }
  }

  const added = []
  const removed = []
  const newDeps = []
  if (blocks.length && closeIdx < 0) {
    return { content: plain, added, removed: [], depsSkipped: true, brokenMark }
  }

  if (blocks.length) {
    const inserted = []
    // 缩进跟随 dependencies 行, 与原生插件的自动块保持一致
    const indent = `${/^[ \t]*/.exec(lines[openIdx])[0]}    `
    for (const block of blocks) {
      if (!block.lines.length) continue
      inserted.push(`${indent}${UTS_MARK_START(block.id)}`)
      for (const line of block.lines) {
        inserted.push(`${indent}${line}`)
        newDeps.push(line.trim())
      }
      inserted.push(`${indent}${UTS_MARK_END(block.id)}`)
    }
    if (inserted.length) {
      lines.splice(closeIdx, 0, ...inserted)
      content = lines.join(eol)
    }
  }

  for (const dep of newDeps) if (!oldDeps.includes(dep)) added.push(dep)
  for (const dep of oldDeps) if (!newDeps.includes(dep)) removed.push(dep)
  return { content, added, removed, depsSkipped, brokenMark }
}

// 主入口: android 侧 UTS 插件集成
export function updateAndroidUtsModules({ appDir, webAppDir }) {
  const result = {
    warnings: [],
    created: [],
    updated: [],
    skipped: [],
    gradleAdded: [],
    gradleRemoved: [],
    settingsChanged: false,
    classpathAdded: false,
    jitpackAdded: false
  }
  const appGradle = path.join(appDir, 'app', 'build.gradle')
  if (!fs.existsSync(appGradle)) return result

  const { android: plugins, warnings } = listUtsPlugins({ webAppDir })
  result.warnings.push(...warnings)
  const raw = fs.readFileSync(appGradle, 'utf8')

  // 主工程参数, 模块模板对齐用
  const compileSdk = Number(/compileSdk\s+(\d+)/.exec(raw)?.[1]) || 35
  // 只取 abiFilters 同一行的值: 单行写法 ndk { abiFilters "x" } 不能把行尾的 } 一起吞进来
  const abiFilters = /abiFilters\s+([^}\n]+)/.exec(raw)?.[1]?.trim() || '"arm64-v8a"'

  const moduleNames = []
  const blocks = []
  const baseLines = []
  for (const plugin of plugins) {
    const moduleName = utsModuleName(plugin.id)
    if (!moduleNames.includes(moduleName)) moduleNames.push(moduleName)

    const scaffold = scaffoldUtsModule({
      appDir,
      id: plugin.id,
      platformDir: plugin.platformDir,
      config: plugin.config,
      compileSdk,
      abiFilters
    })
    result.warnings.push(...(scaffold.warnings || []))
    const moduleDir = path.join(appDir, moduleName)
    if (scaffold.status === 'legacy') {
      result.skipped.push(plugin.id)
      if (scaffold.reason) {
        result.warnings.push(`UTS插件 ${plugin.id}: 同步账本 ${UTS_LEDGER} 已损坏 (${scaffold.reason}), 跳过更新 (请删除 ${moduleDir} 后重新 prepare)`)
      } else {
        result.warnings.push(`UTS插件 ${plugin.id}: 同步账本缺失且内容与生成结果不一致, 视为手工维护, 跳过更新 (如需自动同步请删除 ${moduleDir} 后重新 prepare)`)
      }
    } else if (scaffold.status === 'owner') {
      result.skipped.push(plugin.id)
      result.warnings.push(`UTS插件 ${plugin.id}: ${moduleName} 已由插件 ${scaffold.owner} 生成 (模块名重名), 跳过更新, 请给其中一个插件改名`)
    } else if (scaffold.status === 'conflict') {
      result.skipped.push(plugin.id)
      result.warnings.push(`UTS插件 ${plugin.id}: ${moduleName} 已手工修改 (${scaffold.conflicts.join(', ')}), 跳过更新 (如需重新生成请删除 ${moduleDir} 后重新 prepare)`)
    } else if (scaffold.status === 'created') {
      result.created.push(plugin.id)
      if (scaffold.residual) {
        result.warnings.push(`UTS插件 ${plugin.id}: ${moduleName} 目录缺少 build.gradle (只剩编译残留), 已按导出产物重新生成模块`)
      }
    } else if (scaffold.status === 'updated') {
      result.updated.push(plugin.id)
    }

    const lines = androidConfigDeps(plugin.config)
    lines.push(`implementation project(':${moduleName}')`)
    // 模块内 libs 只对模块自身编译可见 (aar 用 compileOnly, jar 不参与编译),
    // 要打进 apk 必须在 app 侧再引用一次; 多个插件共用同一 fileTree 时 Gradle 会自动去重
    lines.push(`implementation fileTree(dir: rootProject.file('${moduleName}/libs'), include: ['*.aar', '*.jar'])`)
    blocks.push({ id: plugin.id, lines })
  }

  // 基础库块对所有插件共享, id 用「运行时」
  if (plugins.length) blocks.unshift({ id: '运行时', lines: UTS_BASE_DEPS })

  // 依赖去重: 用户手写块里已有的坐标/引用不再写
  const plain = stripUtsBlocks(raw, UAPP_UTS_BLOCK)
  const dedup = (lines) => {
    return lines.filter((line) => {
      const coord = coordOf(line)
      if (coord && new RegExp(`${coord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(plain)) return false
      if (/project\(/.test(line) && plain.includes(line.slice(line.indexOf("project(")))) return false
      return true
    })
  }
  for (const block of blocks) block.lines = dedup(block.lines)

  const gradle = applyUtsGradleBlocks(raw, blocks)
  if (gradle.brokenMark) {
    result.warnings.push('app/build.gradle 里有未闭合的 UTS 标记块 (缺少 所需库-结束 行), 为避免破坏文件未写入, 请检查')
  } else {
    if (gradle.depsSkipped && blocks.some((block) => block.lines.length)) {
      result.warnings.push('app/build.gradle 里没有找到 dependencies { }, UTS 插件依赖未写入')
    }
    if (gradle.content !== raw) fs.writeFileSync(appGradle, gradle.content)
    result.gradleAdded.push(...gradle.added)
    result.gradleRemoved.push(...gradle.removed)
  }

  const settings = updateSettingsGradle({ appDir, moduleNames })
  result.warnings.push(...settings.warnings)
  result.settingsChanged = settings.changed

  const root = updateRootGradle({ appDir, needsJitpack: plugins.length > 0 })
  result.warnings.push(...root.warnings)
  result.classpathAdded = root.classpathAdded
  result.jitpackAdded = root.jitpackAdded

  // utsplugin-release.aar 是运行时必须的; sdk.libs 只能逐行写文件名, 不能写标记块, 所以只检测不代写
  if (plugins.length) {
    const sdkLibs = path.join(appDir, 'app', 'sdk.libs')
    if (fs.existsSync(sdkLibs)) {
      const names = fs.readFileSync(sdkLibs, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      if (!names.includes('utsplugin-release.aar')) {
        result.warnings.push('检测到 UTS 插件, 请在 android/app/sdk.libs 里添加 utsplugin-release.aar (SDK libs 目录下已有该文件)')
      }
    }
  }
  return result
}

// ios 侧: 扫 utsplugins/<id>/ 下的 framework, 生成 custom.yml 组
// framework 已在 config/custom.yml 里配置过的组标记 skipped, 提示层据此区分「已写入/未改动」
export function buildIOSUtsYml({ appDir, webAppDir }) {
  const { ios: plugins, warnings } = listUtsPlugins({ webAppDir })
  const groups = []
  const customYmlFile = path.join(appDir, 'config', 'custom.yml')
  const customYml = fs.existsSync(customYmlFile) ? fs.readFileSync(customYmlFile, 'utf8') : ''
  for (const plugin of plugins) {
    const dir = path.join(appDir, 'utsplugins', plugin.id)
    if (!fs.existsSync(dir)) {
      warnings.push(`UTS插件 ${plugin.id}: ios/utsplugins/${plugin.id} 目录不存在, 请先用 Xcode 构建插件 framework (参考 https://doc.dcloud.net.cn/uni-app-x/native/use/iosuts.html)`)
      continue
    }
    const frameworks = fs.readdirSync(dir).filter((name) => name.endsWith('.framework') && fs.statSync(path.join(dir, name)).isDirectory())
    const xcframeworks = fs.readdirSync(dir).filter((name) => name.endsWith('.xcframework'))
    for (const name of xcframeworks) {
      warnings.push(`UTS插件 ${plugin.id}: 暂不支持 xcframework (${name}), 请转出 framework 或手动配置 config/custom.yml`)
    }
    if (!frameworks.length && !xcframeworks.length) {
      warnings.push(`UTS插件 ${plugin.id}: ios/utsplugins/${plugin.id} 下没有编译好的 framework, 请先用 Xcode 构建后放入 (参考 https://doc.dcloud.net.cn/uni-app-x/native/use/iosuts.html)`)
      continue
    }
    const dependencies = []
    for (const name of frameworks) {
      dependencies.push(`- framework: utsplugins/${plugin.id}/${name}`)
      dependencies.push('  embed: true')
      dependencies.push('  codeSign: true')
    }
    groups.push({
      name: `${plugin.id} UTS插件`,
      dependencies,
      sources: [],
      skipped: frameworks.length > 0 && frameworks.every((name) => customYml.includes(`utsplugins/${plugin.id}/${name}`))
    })
  }
  return { groups, warnings }
}
