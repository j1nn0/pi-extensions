# @j1nn0/pi-shortcuts

再利用可能な Pi ショートカットのストレージ基盤です。現時点ではショートカットの検証・正規化・保存
のみを提供し、ショートカットの作成機能はまだありません。

## 実装状況

このリリースで実装済み:

- ショートカット名の正規化と検証。
- `schemaVersion: 1` レコードの検証。
- 原子的な書き込み、上書き防止、サイズ上限、シンボリックリンク拒否を備えたファイルストア。
- `saveShortcut`、`loadShortcut`、`getShortcut`、`existsShortcut`、`listShortcuts`。

未実装:

- `/shortcut` コマンドをはじめとするユーザー向けコマンド。
- LLM によるショートカット作成とセッション履歴の解析。
- パラメータ置換と保存済み手順の再実行（rerun）。

そのため拡張のエントリポイントはコマンドもツールも登録しません。現時点でこのパッケージを
インストールしても、同じ Pi プロセス内の他のコードからストレージ API を使えるようになるだけです。

## インストール

```text
pi install npm:@j1nn0/pi-shortcuts
```

コマンドがまだないため、インストールは任意です。導入しても目に見える変化はありません。

## 保存場所

ショートカットは `<Pi agent dir>/shortcuts/<name>.json` に保存されます。agent dir は Pi が公開
している `getAgentDir()` から取得するため、`PI_CODING_AGENT_DIR` が反映され、既定値は
`~/.pi/agent` です。各ストア関数はテストや組み込み用に `agentDir` の上書きも受け付けます。

```text
~/.pi/agent/shortcuts/
  review-diff.json
  release-notes.json
```

## レコード形式

```json
{
  "schemaVersion": 1,
  "name": "review-diff",
  "description": "Review the current diff",
  "procedure": "Review the diff and list risky changes.",
  "params": ["target"],
  "createdAt": "2026-01-02T03:04:05.000Z",
  "updatedAt": "2026-01-02T03:04:05.000Z",
  "source": {
    "sessionId": "session-1",
    "range": { "fromEntryId": "entry-1", "toEntryId": "entry-2" },
    "cwd": "/home/user/project",
    "model": "anthropic/claude-sonnet-4"
  }
}
```

検証で強制される規則:

- `schemaVersion` は `1` のみ受け付け、それ以外は未知のスキーマバージョンとして拒否します。
- `name` は正規化済みのスラッグである必要があり、ファイル名と一致していなければなりません。
- `description` は文字列で空でも構いませんが、`procedure` は空でない文字列が必要です。
- `params` は最小限の文字列配列形式です。各要素は 1〜32 文字の英数字・`_`・`-` で、先頭は英数字に
  限ります。大文字小文字を区別せず重複は拒否します。`{ "name": "target" }` のようなオブジェクト
  定義は拒否します。
- `createdAt` と `updatedAt` は `toISOString()` 形式の ISO 8601 UTC タイムスタンプが必要です。
- `source` には `sessionId`、`range.fromEntryId`、`range.toEntryId`、`cwd`、`model` がすべて
  空でない文字列として必要です。
- 未知のトップレベルフィールドは読み込み時に破棄します。

### 名前の規則

名前は NFKC 正規化、前後の空白除去、小文字化を行い、空白とアンダースコアの連続を 1 つの
ハイフンにまとめます。結果は `[a-z0-9]+(-[a-z0-9]+)*` に一致し、64 文字以下である必要があります。
空の名前、パス区切り文字、`..`、先頭のドット、先頭・末尾のハイフン、その他の文字（`café` や
`日本語` など）は拒否します。非 ASCII 名は変換せず拒否するため、ディスク上の名前は常に要求した
スラッグと一致します。

## API

| 関数 | 動作 |
| --- | --- |
| `normalizeShortcutName(raw)` | 純粋な正規化・検証。`{ ok: true, name }` または `{ ok: false, code, message }` を返します。 |
| `parseShortcut(value)` | 純粋な `schemaVersion: 1` 検証。正規化済みレコードまたは失敗を返します。 |
| `parseShortcutJson(text)` | `parseShortcut` に加えて、解析不能なテキストを `corrupt-json` として返します。 |
| `serializeShortcut(record)` | 検証済みレコードを安定した JSON に変換します（末尾に改行）。 |
| `resolveShortcutsDir({ agentDir? })` | ストアのディレクトリ。上書きがなければ `getAgentDir()` から導出します。 |
| `saveShortcut(record, { agentDir?, overwrite? })` | 原子的に保存。`overwrite: true` 以外では既存ショートカットを置き換えません。 |
| `loadShortcut(name, { agentDir? })` | 型付きエラーコードを含む完全な結果を返します。 |
| `getShortcut(name, { agentDir? })` | レコード、または存在しない・不正・読み取り不能な場合は `null`。 |
| `existsShortcut(name, { agentDir? })` | シンボリックリンクでない通常ファイルが存在する場合のみ `true`。不正な名前は `false`。 |
| `listShortcuts({ agentDir? })` | `{ shortcuts, skipped }` を名前順で返します。読み取り不能なファイルは削除せず報告します。 |

ファイルシステムを扱う関数はすべて `{ ok: true, value }` または
`{ ok: false, error: { code, message } }` を返し、想定内の失敗で例外を投げません。エラーコードは
`invalid-name`、`invalid-record`、`corrupt-json`、`unknown-schema-version`、`not-found`、
`already-exists`、`too-large`、`unsafe-path`、`unsupported-entry`、`io-error` です。

## 書き込みと読み込みの保証

- 書き込みは同じディレクトリ内の一意な一時ファイルに行い、fsync したうえで `link()` で確定します
  （対象が現れていれば `already-exists` で失敗）。`overwrite: true` のときだけ `rename()` を使います。
  失敗した場合は以前のファイルを残し、一時ファイルを削除します。
- 保存時と読み込み時の両方で 64 KiB を上限とします。
- 新規のストアディレクトリは `0700`、新規ファイルは `0600` を使用します。既存ディレクトリのモードは
  変更しません。作成後に `chmod` するため、緩い umask でもモードは広がりません。
- シンボリックリンクのストアディレクトリ、シンボリックリンクのショートカットファイル、ストア外に
  解決されるパスは拒否します。
- 壊れた JSON と未知の `schemaVersion` は読み込み時に拒否します。`listShortcuts` はそうした
  ファイルをスキップし、削除も移動もせずに `skipped` として報告します。

## 制限

- シンボリックリンクの検査はパスベースです。Node にはディレクトリ fd を使った `link`/`rename` が
  ないため、検査から確定までの間にストアディレクトリを書き換えられるローカル攻撃者は対象外です。
- 新規ショートカットの作成にはハードリンクが必要です。`link()` が使えない、または拒否される場合
  （`EPERM`、`ENOSYS`、`ENOTSUP`、`EOPNOTSUPP`、`EXDEV`）、意図しない上書きを避けるため新規保存は
  `io-error` で失敗します。明示的な上書きは引き続き `rename()` を使います。
- ディレクトリの fsync はベストエフォートです。一部のプラットフォーム（特に Windows）では未対応です。
- ファイルモードはベストエフォートで、POSIX のモードビットが適用されない Windows では保証されません。
- Windows の予約デバイス名（`con` など）は名前の検証で除外していません。保存すると名前を変えずに
  `io-error` として失敗します。
- ロックやプロセス間キューはなく、後勝ち（last-write-wins）もしません。同時に作成した場合は
  1 つだけが成功し、残りは `already-exists` を受け取ります。
