# Plano da loja Ignix Cloud PC

O painel do cliente, o agente do PIN, os comandos de administração e o banco `atlas.sqlite` permanecem. Não há módulos antigos de catálogo ou ticket neste repositório; a loja entra em `src/loja/` e grava tabelas novas no mesmo arquivo.

A imagem de referência é só o arranjo comercial. A identidade publicada é Ignix Cloud PC.

## Etapas

1. Catálogo e preço em `products.js` e `promotions.js`. Os tamanhos T4 seguem a família NCas_T4_v3 da Azure: NC4as 4 vCPU e 28 GiB, NC8as 8 vCPU e 56 GiB, NC16as 16 vCPU e 110 GiB, uma Tesla T4 de 16 GB. O disco de 512 GB é o disco da imagem, não um campo do tamanho. A10 não é semeada e pode ser incluída pelo comando da loja.
2. Estoque e pedido em `db.js`, com `BEGIN IMMEDIATE`, reserva que expira e devolução ao cancelar ou expirar.
3. Painel Components V2 editado no lugar, em `panel.js`.
4. Pix e webhook da WyzeCash em `payments.js` e `http.js`, com a assinatura `t + "." + corpo cru` e o evento `payment.paid`.
5. Provisionamento idempotente em `provision.js` e `azure.js`. O nome da VM sai do pedido. Um pedido não cria a máquina duas vezes.
6. Entrega, cargo e vencimento em `delivery.js`. O vencimento desliga a VM e avisa. Não apaga a máquina.
7. Comandos e botões em `router.js`, ligados ao processo que já existe.

## O que o administrador configura

`WYZECASH_API_KEY`, `WYZECASH_WEBHOOK_SECRET`, `WYZECASH_API_BASE`, `PUBLIC_URL` e `SERVER_PORT` ficam no ambiente. Banner, textos, horas, estoque, ofertas, cargo, rede e imagem ficam nos comandos e no banco.
