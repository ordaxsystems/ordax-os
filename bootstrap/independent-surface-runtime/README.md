# Independent Surface Runtime — migração Alpine/APK → Buildroot

Este diretório existe somente como **ponte de migração verificável** para o issue #1730. Ele não cria uma segunda distribuição permanente e não altera a autoridade atual do Stable enquanto a paridade não for comprovada.

## Objetivo

Construir o runtime gráfico usado pela Surface diretamente com o mesmo Buildroot pinado pela Independent Base, usando musl e dependências de origem, sem Alpine, sem APK e sem gerenciador de pacotes no runtime.

O artefato candidato é `native-surface-runtime-buildroot.erofs` e mantém o mesmo papel arquitetural do runtime gráfico imutável: payload EROFS montado pelo fluxo portátil canônico. Este diretório não define PID1, updater, release manager, recovery, trust, Creator ou escrita física.

## Gates desta etapa

1. contrato e configuração Buildroot fail-closed;
2. build real do stack gráfico necessário pela Surface;
3. presença dos executáveis/typelibs consumidos pelo runtime atual;
4. ausência comprovada de `apk`, `/etc/apk`, `/lib/apk` e identidade Alpine;
5. EROFS íntegro com proveniência e SHA-256;
6. nenhuma autorização Stable ou física.

## Prova portátil do mesmo artefato

O workflow `Independent Surface Runtime` encadeia o reusable workflow canônico `Portable v2 QEMU Boot Proof` somente depois de um build Buildroot verde. A rota experimental usa `base_source=independent` e `surface_source=independent`.

A prova **não recompila** a Surface com Alpine. Ela baixa o `native-surface-runtime-buildroot.erofs` produzido no mesmo workflow run, executa novamente o verificador Buildroot, exige proveniência ligada ao mesmo `source_commit`, compara o SHA-256 antes e depois do binding e só então apresenta os mesmos bytes ao fluxo portátil pelo nome canônico `native-surface-runtime.erofs`.

Essa integração não equivale a prova concluída enquanto os jobs QEMU/UEFI correspondentes não estiverem verdes. Ela também não autoriza promoção Stable, escrita física ou remoção antecipada do runtime oficial atual.

## Cutover obrigatório — não manter duas bases

Depois que este candidato e a prova portátil do mesmo EROFS estiverem verdes:

1. confirmar a Surface real no QEMU canônico usando **este mesmo EROFS**, incluindo Cage/WebKitGTK, input, DRM/renderização e health observável;
2. provar segundo boot, recovery e rollback sem APK;
3. provar firmware/módulos/hardware do candidato no fluxo físico governado apropriado;
4. substituir atomicamente o builder oficial `bootstrap/surface-runtime` pelo owner Buildroot comprovado;
5. remover do runtime oficial o lock APK, Alpine minirootfs e qualquer caminho de `apk add`/upgrade;
6. somente depois remover os resíduos Alpine da Stable Base e builders associados quando a paridade integral da Independent Base estiver verde.

A existência deste diretório não autoriza adiar o cutover. Ele deve desaparecer ou ser incorporado ao owner oficial quando a migração for concluída.

## Execução

```sh
python3 bootstrap/independent-surface-runtime/build.py check
python3 -m unittest \
  tests.test_independent_surface_runtime \
  tests.test_independent_surface_qemu_binding -v

python3 bootstrap/independent-surface-runtime/build.py build \
  --out /tmp/ordax-independent-surface \
  --cache /tmp/ordax-independent-surface-cache \
  --jobs 4

python3 bootstrap/independent-surface-runtime/build.py verify \
  --out /tmp/ordax-independent-surface
```

Não interpretar `check`, testes unitários ou a existência do encadeamento QEMU como prova do runtime gráfico. O build real comprova o artefato; a prova QEMU/UEFI só existe quando o reusable workflow canônico conclui verde sobre o EROFS produzido no mesmo run.
