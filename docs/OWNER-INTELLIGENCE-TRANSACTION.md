# Intelligence — transação canônica do OS

O OrdaX OS possui a única fonte de Intelligence em system/intelligence/.
O Supervisor extrai apenas o commit selecionado do próprio OS, e
system/intelligence/owner-stage.sh compara os blobs Git antes da troca
de slot. O antigo repo de origem não é clonado, consultado nem pinado.

tools/intelligence/verify.py produz um recibo de proveniência na área
descartável de release e verifica cada blob de código, builder e contrato.
O slot conserva .sha, .ready, manifesto SHA256 e .intelligence-source-sha,
que agora é igual ao SHA do OS.

Divergência causa rejeição/rollback. Artefatos de modelo ou executáveis
não entram no Git. A migração de código não autoriza ativação, modelos,
Stable, gravação física, grants ou serviço MCP paralelo.

Validar os testes dirigidos e o mesmo commit; nenhum rebuild geral.
