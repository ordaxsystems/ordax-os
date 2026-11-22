# Creator — módulo do OrdaX OS

As regras canônicas estão na raiz: [AGENTS.md](../AGENTS.md) e [docs/DEVELOPMENT-WORKFLOW.md](../docs/DEVELOPMENT-WORKFLOW.md). Este diretório não tem fonte Git ou publicador independentes.

O módulo creator/ contém o Core Go, a interface Win32 e seus adaptadores físicos. Os produtores de mídia, assinaturas, promoção e o Update Engine permanecem na autoridade OS. Não adicionar outro atualizador, escritor ou serviço.

Gravar mídia física exige seleção e autorização específicas, revalidação de identidade e integridade, elevação e readback; a política DEV não substitui esses gates.
