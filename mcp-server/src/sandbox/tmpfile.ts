/**
 * 临时文件 / 目录管理。
 *
 * 沙箱执行 C/C++/Java/Python 需要把代码写到磁盘再交给编译器/解释器。
 * 这里统一生成带 examforge_ 前缀 + 随机串的唯一路径,并在执行完毕后清理。
 *
 * Windows 兼容:统一用 os.tmpdir() + path.join,不硬编码分隔符。
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** 单个临时文件句柄:path 为文件路径(创建时仅占用名字,内容由调用方写入),cleanup 删除它。 */
export interface TempFile {
  path: string;
  cleanup: () => Promise<void>;
}

/** 临时目录句柄:用于需要按特定文件名组织产物的场景(如 Java 的 Main.java / Main.class)。 */
export interface TempDir {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * 生成一个唯一的临时文件路径(不预先创建文件,由调用方写入)。
 * @param ext 扩展名,需带点,如 ".c" / ".cpp" / ".py"
 */
export async function createTempFile(ext: string): Promise<TempFile> {
  const filename = `examforge_${randomUUID()}${ext}`;
  const filePath = join(tmpdir(), filename);
  return {
    path: filePath,
    cleanup: async () => {
      // force:true 保证文件不存在时不报错(编译失败/未写入等情况)
      await fs.rm(filePath, { force: true });
    },
  };
}

/**
 * 生成一个唯一的临时目录(立即创建)。
 * 用于 Java:把 Main.java 写进去,javac 产物 Main.class 也在同一目录,执行后整体清理。
 */
export async function createTempDir(): Promise<TempDir> {
  const dirName = `examforge_${randomUUID()}`;
  const dirPath = join(tmpdir(), dirName);
  await fs.mkdir(dirPath, { recursive: false });
  return {
    path: dirPath,
    cleanup: async () => {
      // recursive:true 递归删除目录及内部所有文件(.java/.class 等)
      await fs.rm(dirPath, { force: true, recursive: true });
    },
  };
}
