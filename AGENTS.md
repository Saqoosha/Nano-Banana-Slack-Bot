# Repository Guidelines

## プロジェクト構成とモジュール
- `src/`: 実装（言語未確定。ドメイン単位でサブディレクトリ）
- `tests/`: ユニット/結合テスト
- `scripts/`: 補助スクリプト（生成・検証）
- `assets/`: 画像/サンプルデータ
- `docs/`: 設計メモ/仕様
- `.github/`: CI ワークフロー
- 例: `src/core/`, `src/cli/`, `tests/core/test_parser.*`

## ビルド・テスト・開発コマンド
このリポジトリは初期状態のため、共通の Make ターゲットを採用します。必要に応じて追加してください。

```
make setup   # 依存関係の取得/初期化
make build   # ビルド（言語に応じた実装）
make run     # ローカル実行（エントリポイント: src/cli など）
make test    # 全テスト実行
make fmt     # フォーマット
make lint    # 静的解析
make clean   # 生成物削除
```

## コーディング規約と命名
- インデント: JS/TS 2 スペース、Python/C#/Go 4 スペース
- ファイル末尾に改行、UTF-8、行長 ~100
- 命名: ディレクトリ/ファイルは-kebab-case、型/クラスは PascalCase、メソッド/関数は camelCase
- 推奨ツール: JS/TS→ Prettier + ESLint、Python→ Black + Ruff、Go→ go fmt、C#→ dotnet format

## テスト方針
- 構成: 単体→結合→最小限のE2E
- 目標カバレッジ: 80% 以上（CIで計測）
- 命名例: `tests/<領域>/test_*.py`, `src/__tests__/*.test.ts`, `tests/*Tests.cs`
- 実行例: `make test`（内部で `pytest`/`vitest`/`dotnet test` などを呼び出す）

## コミットとプルリク
- 方式: Conventional Commits（例: `feat(core): add parser`）
- 1 コミット = 1 目的。差分が説明になるように小さく分割
- PR 要件: 目的/背景/変更点/スクリーンショット or ログ/テスト結果/関連Issue を記載
- PR タイトルはリリースノートにそのまま載っても意味が通る形に

## セキュリティと設定
- 秘密情報はコミット禁止。`env/.env.sample` を雛形に `cp env/.env.sample env/.env`
- ローカル変数管理は `direnv` などを推奨
- CI には GitHub Secrets を使用。鍵・トークンはIssue/PRに貼らない

