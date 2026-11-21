import SparkMD5 from 'spark-md5'

/** 浏览器端增量计算本地文件 MD5（分片读取，不整块载入内存） */
export async function md5File(file: File, onProgress?: (ratio: number) => void): Promise<string> {
  const chunkSize = 8 * 1024 * 1024
  const spark = new SparkMD5.ArrayBuffer()
  let offset = 0
  while (offset < file.size) {
    const buf = await file.slice(offset, offset + chunkSize).arrayBuffer()
    spark.append(buf)
    offset += chunkSize
    onProgress?.(Math.min(1, offset / file.size))
  }
  return spark.end()
}
