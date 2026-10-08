# Publicação do cache Native de artefatos da Loja

Owner: `system/surface/runtime/native_app_artifact_store.py`

O cache de artefatos é **content-addressed**, derivado exclusivamente de
identidades já validadas no plano do lifecycle. Este módulo não recebe URLs
ou seletores de versão, não verifica assinatura, não concede permissões e não
ativa apps. Assinatura, compatibilidade e ativação continuam em seus owners.

## Persistência sem substituição

Após validar SHA-256 e tamanho, os bytes são gravados em staging privado
no mesmo diretório de destino, sincronizados e marcados `0400`.
A publicação usa **`os.link(staging, destino)`** para criar o nome
definitivo de forma atômica e **não substitutiva**. Em sucesso, o nome de
staging é retirado e o diretório é sincronizado; somente então o arquivo
é reaberto e validado como arquivo regular, privado, com um único hardlink,
bytes e SHA-256 corretos.

O lock por digest coordena publicadores cooperativos, mas não justifica
`os.replace()`: um escritor concorrente que não segue esse lock poderia
criar um arquivo/symlink depois da checagem inicial. Nessa condição,
`os.link` falha com destino existente, sem tocá-lo; o staging da tentativa
é limpo e a operação **falha fechada**. Não apagar um destino que não
pertence a esta publicação. Uma falha de `fsync` também não declara
sucesso. A recuperação usa as verificações canônicas de cache.

Este mecanismo requer filesystem local com hardlinks; sem suporte,
a publicação **não** deve fazer fallback para `os.replace`/cópia
não atômica. Não criar outro CAS nem mecanismo paralelo de trust.

## Provas

`tests/test_native_app_artifact_store.py` cobre publicação íntegra
com `st_nlink == 1`, reutilização válida, corrupção, permissões, symlinks
e a corrida na qual outro escritor cria arquivo regular ou symlink
imediatamente antes da publicação. A suíte é executada pelo workflow
`runtime-component-candidate.yml`, que controla este mesmo owner.
