# Validação física inicial do Stable/MVP — 2026-09-27

## Escopo

Este checkpoint registra somente fatos observados no primeiro ciclo físico do OrdaX Stable/MVP e as correções de produto derivadas desses fatos. Ele não promove o MVP para pronto para usuário final e não substitui os gates assinados de release.

## Evidência já obtida

- A mídia física Stable/MVP foi criada pelo writer governado com resultado `pass-readback-verified`.
- O writer executou 39 operações, materializou 17 artefatos e confirmou readback de 17/17 artefatos.
- Um computador físico inicializou o USB pelo caminho UEFI e atingiu a Surface gráfica real.
- O First Run real foi exibido em hardware, comprovando a cadeia UEFI -> systemd-boot -> kernel/initramfs -> Portable PID1 -> Stable Base -> release -> Surface.
- O mesmo computador também expôs uma entrada Legacy/CSM para o mesmo USB; somente a entrada UEFI faz parte do contrato atual do produto.

## Defeitos revelados pelo hardware

### Rede

A Surface física informou que o gerenciamento de Wi-Fi não estava disponível. A investigação encontrou uma divergência estrutural: o Stable Base entrega os drivers Wi-Fi suportados como módulos, mas o network broker nativo procurava uma interface em `/sys/class/net` sem ativar esses módulos. O owner de rede agora assume explicitamente essa responsabilidade e mantém a lista de módulos ligada ao contrato do Stable Base por teste automatizado.

A correção de código ainda exige nova build assinada e reteste físico. Não há alegação de Wi-Fi físico corrigido antes desse reteste.

### First Run em tela física

Em resolução física menor, o conteúdo do passo de Segurança podia empurrar o rodapé para fora da área visível. O shell agora é limitado à viewport; somente o corpo do passo rola e o rodapé de ações permanece em uma região própria e visível.

### Janelas

Apps de primeira parte eram abertos restaurados por padrão. A política do produto passa a abrir novas janelas maximizadas dentro da área útil da Surface, preservando rail/sidebar e barra inferior e mantendo restauração/movimento como ação explícita do usuário.

### Identidade visual

Os tokens aprovados da landing já existem no runtime, mas a preferência padrão da Surface ainda era `light`. O padrão passa a ser `dark`, usando a identidade grafite/azul glacial documentada como referência oficial. A preferência de tema continua disponível ao usuário.

### Boot

O primeiro boot físico expôs logos Tux porque o kernel estava com `CONFIG_LOGO=y`. O kernel de produto passa a compilar com `CONFIG_LOGO` desativado. O boot normal passa a ser silencioso e mantém evidência serial; o recovery permanece explicitamente visível e verboso em `tty0` + serial.

O USB físico usado na descoberta contém o kernel anterior e uma entrada de boot temporariamente alterada para diagnóstico. As mudanças permanentes deste checkpoint só entram em uma nova build/release governada.

## Itens ainda não fechados

- Reteste físico do Wi-Fi com nova build assinada.
- Reteste de Conta OrdaX depois de conectividade real; nenhuma ação de login deve ser artificialmente habilitada sem o provider real.
- Medição de desempenho de Files/Projects/Notes/Internet em hardware antes de qualquer otimização específica.
- Investigação da demora de firmware/controlador SATA observada em uma máquina física sem aplicar parâmetros específicos de hardware ao produto global.
- Validação em mais de uma implementação UEFI e tratamento/documentação clara para máquinas que escondem a distinção UEFI/Legacy.
- Evolução do boot visual OrdaX sem reintroduzir logs técnicos no fluxo normal.

## Critério de saída

Este checkpoint só pode evoluir para uma afirmação de MVP físico pronto após uma nova mídia/release assinada passar por boot UEFI, rede real, First Run completo, persistência após reboot, Conta quando disponível, apps principais e desempenho aceitável em hardware físico representativo.
