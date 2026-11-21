import fs from 'fs-extra'
import path from 'node:path'

export function isNativePluginPath(relative) {
  return /^uni_modules\/[^/]+\/(?:utssdk(?:\/|$)|app-(?:android|ios|harmony)(?:\/|$))/.test(relative.split(path.sep).join('/'))
}

export function removeEmptyModuleDirectories(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyModuleDirectories(path.join(directory, entry.name))
  }
  if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory)
}
