// A bounded, stdin-only decoder. There are no filesystem or network operations.
package main

import (
  "fmt"
  "io"
  "os"
  "strconv"
  "codex-report-decoder/zstd"
)

func main() {
  if len(os.Args) != 2 { os.Exit(2) }
  limit, err := strconv.ParseInt(os.Args[1], 10, 64)
  if err != nil || limit < 1 || limit > 2147483648 { os.Exit(2) }
  reader := zstd.NewReader(os.Stdin)
  n, err := io.Copy(os.Stdout, io.LimitReader(reader, limit + 1))
  if err != nil || n > limit { fmt.Fprintln(os.Stderr, "Invalid or oversized Zstandard stream"); os.Exit(1) }
}
