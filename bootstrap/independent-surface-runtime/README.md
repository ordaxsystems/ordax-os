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

## Cutover obrigatório — não manter duas bases

Depois que este candidato construir de forma reproduzível:

1. executar a Surface real em QEMU usando **este mesmo EROFS** e os owners canônicos de boot/assinatura/health;
2. provar Cage/WebKitGTK, input, DRM/renderização, health, segundo boot, recovery e rollback sem APK;
3. provar firmware/módulos/hardware do candidato no fluxo físico governado apropriado;
4. substituir atomicamente o builder oficial `bootstrap/surface-runtime` pelo owner Buildroot comprovado;
5. remover do runtime oficial o lock APK, Alpine minirootfs e qualquer caminho de `apk add`/upgrade;
6. somente depois remover os resíduos Alpine da Stable Base e builders associados quando a paridade integral da Independent Base estiver verde.

A existência deste diretório não autoriza adiar o cutover. Ele deve desaparecer ou ser incorporado ao owner oficial quando a migração for concluída.

## Execução

```sh
python3 bootstrap/independent-surface-runtime/build.py check
python3 -m unittest tests.test_independent_surface_runtime -v

python3 bootstrap/independent-surface-runtime/build.py build \
  --out /tmp/ordax-independent-surface \
  --cache /tmp/ordax-independent-surface-cache \
  --jobs 4

python3 bootstrap/independent-surface-runtime/build.py verify \
  --out /tmp/ordax-independent-surface
```

Não interpretar `check` ou testes unitários como prova do runtime gráfico. A prova relevante desta etapa é o build Buildroot real e seu artefato; a prova seguinte será boot/Surface real sobre o mesmo artefato.
