# worker: Claude API の中継（Cloudflare Workers）

画面からの質問を Anthropic の Messages API に中継する小さな Worker です。API キーを画面側に置かないために使います。

## できること

- `POST /api/chat` だけを受け付けます（それ以外のパスは 404、他のメソッドは 405）。
- 本文は `{ messages, tools }` です。モデル（`claude-sonnet-5-5`）、`max_tokens`（1500）、システムプロンプトは Worker が決め、画面から来た値は使いません。`messages` と `tools` は、確かめた項目から作り直して送ります（余分な項目、ブロックの `cache_control`、画像や文書のブロックは届きません）。
- `tools` の名前は許可リスト（`allowlist.ts` の 7 つ）だけです。許可リストにない名前は 400 です。
- 本文は 64KB まで（超えると 413）。メッセージは 40 件まで、テキストの合計は 48,000 文字までです。
- 応答は上流が 200 のときだけそのまま返します。上流が 200 以外（4xx も含む）、ネットワークの失敗は、中身を見せずに 502 `{ "error": "upstream_error" }` です。
- 呼び出せる出どころは `ALLOWED_ORIGINS`（カンマ区切り、完全一致）だけです。`Origin` が無い、または違う場合は 403 です。

## 制限は「できるだけ」の仕組みです（Limits are best-effort）

1 日の上限（1 つの IP あたり 20 回、全体で 300 回。`DAILY_IP_LIMIT`・`DAILY_TOTAL_LIMIT` で変えられます）は、Workers KV の数え上げで実装しています。これは**防御の最後の砦ではなく、通常の使い方での目安**です。

- KV には「足し算を 1 回で行う」命令がなく、読んでから書く方式です。同時に届いた要求は同じ値を読んで互いの書き込みを上書きします（更新の取りこぼし）。
- そのため、短い間に集中した要求は**大きく少なく数えられます**。試験（`index.test.ts` の「best-effort」）で、1 つの IP あたり 3 回・全体 5 回の上限に対して 50 件の同時要求がすべて通ることを確かめています。「数件のずれ」ではありません。
- KV は反映が遅れることもあり（結果整合）、これも数え漏れの原因です。
- 害を小さくするため、書き込みは「全体 → IP」の順に 1 つずつ行い、全体の書き込みが失敗したら IP は数えません。KV が使えないときは通さずに 503 を返します（fail closed）。
- IP は HMAC-SHA-256（鍵は `IP_HASH_SECRET`）で変換して保存し、生のアドレスは保存しません。IPv6 は /64 の範囲で 1 人と数えます。

**お金の本当の上限は、API キーを持つ Anthropic ワークスペースの利用上限（spend limit）です。** 公開する前に必ず設定してください。

## 公開前のチェックリスト（承認を得てから）

公開（デプロイ）は本人の承認を得てから行います。勝手に実行しません。

- [ ] Anthropic のワークスペースに利用上限（spend limit）を設定した（最も大事な上限）
- [ ] `wrangler.jsonc` の `ALLOWED_ORIGINS` から `http://localhost:5173` を外し、公開ページの出どころ（例 `https://…pages.dev`）だけにした
- [ ] KV の名前空間を作り、`wrangler.jsonc` の `kv_namespaces[0].id` の仮の値を本物に置き換えた
- [ ] `wrangler secret put ANTHROPIC_API_KEY` で API キーを登録した（コードにも設定ファイルにも書かない）
- [ ] `wrangler secret put IP_HASH_SECRET` で長いランダムな文字列を登録した
- [ ] 別のベンダーによる第二の意見のレビュー（コードレビュー）を済ませた
- [ ] 公開後、公開ページから 1 回だけ実際に質問して動作を確かめた

## 設定

| 名前 | 種類 | 内容 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 秘密 | Anthropic の API キー。応答にもログにも出しません。 |
| `IP_HASH_SECRET` | 秘密 | IP を変換する HMAC の鍵。未設定なら 503 `server_misconfigured`。 |
| `RATE_KV` | KV | 日ごとの数え上げ（キーは UTC の日付つき、2 日で消えます）。 |
| `ALLOWED_ORIGINS` | 変数 | 呼び出してよい出どころ（カンマ区切り）。 |
| `DAILY_IP_LIMIT` / `DAILY_TOTAL_LIMIT` | 変数（任意） | 既定は 20 / 300。`0` で全部止められます。 |

## ローカルでの確認

```sh
npx vitest run worker      # 試験（fetch と KV は偽物。実際の API は呼びません）
npm run typecheck
cp worker/.dev.vars.example worker/.dev.vars   # 手元で wrangler dev をするときだけ。.dev.vars は git に入れません
```

## 今後（Task 13）

道具の定義（名前・説明・入力の形）は、今は画面から送られてきたものを検証して使っています。Task 13 で、サーバー側の正本（`src/ai/toolDefs.ts` を共有）に切り替え、画面からの `tools` を受け取らない形にします。
