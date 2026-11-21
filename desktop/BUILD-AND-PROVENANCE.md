# Desktop — cadeia canônica

Owner único: ordaxsystems/ordax-os/main. Código Windows em desktop/.
Source da Surface e Native: system/, do mesmo SHA. O único produtor NSIS:
.github/workflows/windows-desktop-dev.yml. O instalador preserva o mesmo
appId e productName, com inspeção de fontes Git, manifestos com hashes
dos arquivos empacotados, integridade da Surface, recuperação e autorização.

Para publicar DEV, fornecer SHA exato aprovado da main ao workflow e
executar os gates físicos de NSIS; não publicar ou recompilar por rotina.
A instância Windows já instalada não é alterada pelo corte de código.
Runtime e Platform continuam independentes e são consumidos só via contratos.
