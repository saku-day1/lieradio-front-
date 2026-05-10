/**
 * エントリポイント
 * AppController を生成して初期化するだけ。
 * 将来 Spring Boot 構成に移行しても、このファイルは変わらない。
 */

import AppController from "./controller/AppController.js";

const app = new AppController();
app.init();
