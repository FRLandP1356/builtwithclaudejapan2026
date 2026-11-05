# 「AIに質問」の問い合わせ先

画面は質問を、ビルドのときに環境変数 `VITE_CHAT_ENDPOINT` で決めた Worker の URL に送ります（例: `VITE_CHAT_ENDPOINT=https://example.workers.dev/api/chat npm run build`。未設定なら同じ出どころの `/api/chat`）。ビルドで文字列に埋め込まれるので、変えたら作り直します。
Worker は、公開ページの出どころ（`https://…`、末尾の `/` なし）を `ALLOWED_ORIGINS` に入れておく必要があります。入っていないと 403 になり、画面は「AIへの問い合わせでエラーが起きました」と保存済みの質問の例を出します。
