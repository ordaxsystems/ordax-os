# OrdaX Desktop Adapter

Status: CANONICAL OS CAPABILITY BOUNDARY

`system/adapters/desktop/` pertence ao `ordax-os` e traduz capacidades públicas do sistema para um host desktop. **Não é o aplicativo Windows**: o host/empacotador Electron canônico pertence a `ordaxsystems/ordax-desktop`.

## Relação entre owners

```text
ordax-surface (UI compartilhada)
        |
        v
ordax-os (host Native, services, contracts, desktop capability adapter)
        |
        v
ordax-desktop (Electron/NSIS Windows)
```

O Desktop consome uma composição OrdaX/OS verificável. Não mantém um segundo pin da Surface, não copia Apps/Intelligence e não recria serviços do OS.

## Authority model

O aplicativo Windows roda como usuário normal por padrão. Capacidades privilegiadas devem permanecer estreitas, tipadas, consentidas e no owner correto. O adapter não pode expor shell genérico, execução arbitrária, raw-device irrestrito ou credenciais à Surface.

Capacidades desktop possíveis incluem arquivos selecionados pelo usuário, notificações, deep links, background work suportado pelo host, integração com aplicativos/arquivos, estado de versão/updater e diagnóstico do host. Cada port deve declarar se é não privilegiado, consent-gated, helper-gated ou indisponível.

## Creator / mídia física

A criação e verificação de mídia é implementada por `ordaxsystems/ordax-creator`, que consome artefatos/mídia produzidos e autorizados pelo `ordax-os`. O Desktop pode **apresentar ou iniciar** a experiência Creator quando o produto exigir, mas não deve duplicar Core, writer, seleção de disco, readback ou pins transitivos.

Escrita física continua exigindo seleção explícita do alvo, revalidação de identidade, consentimento e gates dos contratos de mídia. A Surface nunca recebe handles privilegiados.

## Update separation

```text
OrdaX Desktop application
  -> canal Desktop/NSIS

OrdaX bootable/native system
  -> release/update canônico do OS

OrdaX Creator
  -> consome mídia verificada e executa preparação autorizada
```

Um canal não deve atualizar silenciosamente o outro.

## Shared Surface invariant

Código desktop específico fornece capabilities e integração de host, mas não recria UI, Settings, Account, Store, apps ou design tokens. A apresentação visual pertence ao `ordax-surface`; serviços, composição e contratos permanecem no OS.

## Implementação vigente

O host Windows canônico é o Electron/NSIS de `ordaxsystems/ordax-desktop`. Referências históricas a Tauri ou a um shell Windows ainda “pendente” não representam a arquitetura atual. Framework do host não é contrato público; a fronteira está nos ports/capabilities e na composição verificável.

Nenhuma chave privada, device private key, token ou segredo de release pertence a este diretório ou a bundle de cliente.
