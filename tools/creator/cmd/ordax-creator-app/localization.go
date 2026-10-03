package main

import (
	"sort"
	"strings"
	"sync"
)

type creatorLocale string
type creatorMessageID string

const (
	creatorLocalePTBR   creatorLocale = "pt-BR"
	creatorLocaleENUS   creatorLocale = "en-US"
	creatorSourceLocale               = creatorLocalePTBR
)

const (
	msgExperienceErrorEyebrow    creatorMessageID = "creator.experience.error.eyebrow"
	msgExperienceErrorTitle      creatorMessageID = "creator.experience.error.title"
	msgExperienceErrorBody       creatorMessageID = "creator.experience.error.body"
	msgActionRetry               creatorMessageID = "creator.action.retry"
	msgActionClose               creatorMessageID = "creator.action.close"
	msgCompleteEyebrow           creatorMessageID = "creator.experience.complete.eyebrow"
	msgCompleteTitle             creatorMessageID = "creator.experience.complete.title"
	msgCompleteBody              creatorMessageID = "creator.experience.complete.body"
	msgCompleteDetail            creatorMessageID = "creator.experience.complete.detail"
	msgActionFinish              creatorMessageID = "creator.action.finish"
	msgActionBootHelp            creatorMessageID = "creator.action.bootHelp"
	msgCreatingEyebrow           creatorMessageID = "creator.experience.creating.eyebrow"
	msgCreatingTitle             creatorMessageID = "creator.experience.creating.title"
	msgCreatingBody              creatorMessageID = "creator.experience.creating.body"
	msgCreatingDetail            creatorMessageID = "creator.experience.creating.detail"
	msgConnectEyebrow            creatorMessageID = "creator.experience.connect.eyebrow"
	msgConnectTitle              creatorMessageID = "creator.experience.connect.title"
	msgConnectBody               creatorMessageID = "creator.experience.connect.body"
	msgConnectDetail             creatorMessageID = "creator.experience.connect.detail"
	msgActionReloadUSB           creatorMessageID = "creator.action.reloadUsb"
	msgSelectEyebrow             creatorMessageID = "creator.experience.select.eyebrow"
	msgSelectTitle               creatorMessageID = "creator.experience.select.title"
	msgSelectBody                creatorMessageID = "creator.experience.select.body"
	msgSelectDetail              creatorMessageID = "creator.experience.select.detail"
	msgActionContinue            creatorMessageID = "creator.action.continue"
	msgBlockedEyebrow            creatorMessageID = "creator.experience.blocked.eyebrow"
	msgBlockedTitle              creatorMessageID = "creator.experience.blocked.title"
	msgBlockedBody               creatorMessageID = "creator.experience.blocked.body"
	msgBlockedDetail             creatorMessageID = "creator.experience.blocked.detail"
	msgActionReload              creatorMessageID = "creator.action.reload"
	msgReviewEyebrow             creatorMessageID = "creator.experience.review.eyebrow"
	msgReviewTitle               creatorMessageID = "creator.experience.review.title"
	msgReviewBody                creatorMessageID = "creator.experience.review.body"
	msgReviewDetail              creatorMessageID = "creator.experience.review.detail"
	msgActionCreate              creatorMessageID = "creator.action.create"
	msgActionBack                creatorMessageID = "creator.action.back"
	msgBootHelp                  creatorMessageID = "creator.bootHelp.body"
	msgTargetUnnamed             creatorMessageID = "creator.target.unnamed"
	msgVersionUpdated            creatorMessageID = "creator.version.updated"
	msgRefreshSearching          creatorMessageID = "creator.refresh.searching"
	msgRefreshHint               creatorMessageID = "creator.refresh.hint"
	msgHeaderTitle               creatorMessageID = "creator.header.title"
	msgHeaderSubtitle            creatorMessageID = "creator.header.subtitle"
	msgFieldUSB                  creatorMessageID = "creator.field.usb"
	msgFieldLanguage             creatorMessageID = "creator.field.language"
	msgUpdateChecking            creatorMessageID = "creator.update.checking"
	msgUpdateAvailableAction     creatorMessageID = "creator.update.availableAction"
	msgUpdateControl             creatorMessageID = "creator.update.control"
	msgProgressStartingStatus    creatorMessageID = "creator.progress.starting.status"
	msgProgressStartingHint      creatorMessageID = "creator.progress.starting.hint"
	msgProgressElevationStatus   creatorMessageID = "creator.progress.elevation.status"
	msgProgressElevationHint     creatorMessageID = "creator.progress.elevation.hint"
	msgProgressTargetStatus      creatorMessageID = "creator.progress.target.status"
	msgProgressTargetHint        creatorMessageID = "creator.progress.target.hint"
	msgProgressImageStatus       creatorMessageID = "creator.progress.image.status"
	msgProgressValidationBytes   creatorMessageID = "creator.progress.validation.bytes"
	msgProgressPlanningStatus    creatorMessageID = "creator.progress.planning.status"
	msgProgressPlanningHint      creatorMessageID = "creator.progress.planning.hint"
	msgProgressLockStatus        creatorMessageID = "creator.progress.lock.status"
	msgProgressLockHint          creatorMessageID = "creator.progress.lock.hint"
	msgProgressWritingStatus     creatorMessageID = "creator.progress.writing.status"
	msgProgressWritingBytes      creatorMessageID = "creator.progress.writing.bytes"
	msgProgressFlushStatus       creatorMessageID = "creator.progress.flush.status"
	msgProgressFlushHint         creatorMessageID = "creator.progress.flush.hint"
	msgProgressVerifyingStatus   creatorMessageID = "creator.progress.verifying.status"
	msgProgressVerifyingBytes    creatorMessageID = "creator.progress.verifying.bytes"
	msgProgressVerifiedStatus    creatorMessageID = "creator.progress.verified.status"
	msgProgressVerifiedHint      creatorMessageID = "creator.progress.verified.hint"
	msgProgressDataStatus        creatorMessageID = "creator.progress.data.status"
	msgProgressDataHint          creatorMessageID = "creator.progress.data.hint"
	msgProgressCompleteStatus    creatorMessageID = "creator.progress.complete.status"
	msgProgressCompleteHint      creatorMessageID = "creator.progress.complete.hint"
	msgVersionChecking           creatorMessageID = "creator.version.checking"
	msgVersionAvailable          creatorMessageID = "creator.version.available"
	msgRefreshFailedDetail       creatorMessageID = "creator.refresh.failed.detail"
	msgPhysicalWriteFailedDetail creatorMessageID = "creator.write.failed.detail"
	msgTargetSelectionFailed     creatorMessageID = "creator.target.selectionFailed"
	msgWriteCompleteStatus       creatorMessageID = "creator.write.complete.status"
	msgWriteCompleteDialogTitle  creatorMessageID = "creator.write.complete.dialogTitle"
	msgWriteCompleteDialogBody   creatorMessageID = "creator.write.complete.dialogBody"
	msgWriteErrorDialogTitle     creatorMessageID = "creator.write.error.dialogTitle"
	msgWriteBusyDetail           creatorMessageID = "creator.write.busy.detail"
	msgWriteConfirmTitle         creatorMessageID = "creator.write.confirm.title"
	msgWriteConfirmBody          creatorMessageID = "creator.write.confirm.body"
	msgWritePreparingStatus      creatorMessageID = "creator.write.preparing.status"
	msgWritePreparingHint        creatorMessageID = "creator.write.preparing.hint"
	msgUpdateDevChannelBody      creatorMessageID = "creator.update.devChannel.body"
	msgUpdateAvailableTitle      creatorMessageID = "creator.update.available.title"
	msgUpdateFailedBody          creatorMessageID = "creator.update.failed.body"
	msgUpdateCurrentBody         creatorMessageID = "creator.update.current.body"
	msgUpdateBundleManualBody    creatorMessageID = "creator.update.bundleManual.body"
	msgPortablePlanStatus        creatorMessageID = "creator.write.portablePlan.status"
	msgPortablePlanHint          creatorMessageID = "creator.write.portablePlan.hint"
	msgPortableElevationHint     creatorMessageID = "creator.write.portableElevation.hint"
	msgPortableVerifiedHint      creatorMessageID = "creator.write.portableVerified.hint"
)

var creatorPTBRMessages = map[creatorMessageID]string{
	msgExperienceErrorEyebrow:    "Precisamos da sua atenção",
	msgExperienceErrorTitle:      "Não foi possível continuar",
	msgExperienceErrorBody:       "O Creator interrompeu o processo antes de fazer algo inseguro.",
	msgActionRetry:               "Tentar novamente",
	msgActionClose:               "Fechar",
	msgCompleteEyebrow:           "Tudo pronto",
	msgCompleteTitle:             "Seu OrdaX USB foi criado",
	msgCompleteBody:              "O pendrive foi preparado e verificado. Agora você pode reiniciar o computador e iniciar pelo USB.",
	msgCompleteDetail:            "Se o computador não iniciar pelo pendrive automaticamente, abra o menu de boot da máquina e escolha o USB.",
	msgActionFinish:              "Concluir",
	msgActionBootHelp:            "Como iniciar pelo USB",
	msgCreatingEyebrow:           "Criando o OrdaX USB",
	msgCreatingTitle:             "Não remova o pendrive",
	msgCreatingBody:              "O Creator está preparando, gravando e verificando o OrdaX automaticamente.",
	msgCreatingDetail:            "A verificação final relê os arquivos gravados para confirmar integridade antes de concluir.",
	msgConnectEyebrow:            "Etapa 1 de 4",
	msgConnectTitle:              "Conecte um pendrive USB",
	msgConnectBody:               "Use um pendrive que possa ser apagado. O Creator encontra dispositivos USB compatíveis automaticamente.",
	msgConnectDetail:             "Os discos internos do computador não são oferecidos como destino pelo Creator.",
	msgActionReloadUSB:           "Recarregar USB",
	msgSelectEyebrow:             "Etapa 2 de 4",
	msgSelectTitle:               "Escolha o pendrive",
	msgSelectBody:                "Confira nome e capacidade antes de continuar. Somente o USB escolhido poderá ser apagado.",
	msgSelectDetail:              "O Creator revalida a identidade do dispositivo novamente antes da gravação.",
	msgActionContinue:            "Continuar",
	msgBlockedEyebrow:            "Criação indisponível",
	msgBlockedTitle:              "Este Creator ainda não pode gravar o USB",
	msgBlockedBody:               "O pendrive foi detectado com segurança, mas este canal do Creator não possui autorização física para criar uma mídia Stable/MVP.",
	msgBlockedDetail:             "Nenhuma alteração foi feita no pendrive.",
	msgActionReload:              "Recarregar",
	msgReviewEyebrow:             "Etapa 3 de 4",
	msgReviewTitle:               "Revise antes de criar",
	msgReviewBody:                "O pendrive selecionado será apagado e preparado para executar o OrdaX diretamente pelo USB.",
	msgReviewDetail:              "O Creator não instala nada no SSD ou HD interno. Depois da confirmação, o Windows ainda solicitará autorização administrativa (UAC).",
	msgActionCreate:              "Criar OrdaX",
	msgActionBack:                "Voltar",
	msgBootHelp:                  "Como iniciar pelo OrdaX USB\n\n1. Deixe o pendrive OrdaX conectado ao computador.\n2. Reinicie o computador.\n3. Abra o menu de boot/UEFI da máquina. A tecla varia conforme o fabricante.\n4. Escolha o dispositivo USB/UEFI correspondente ao pendrive OrdaX.\n5. O OrdaX inicia diretamente pelo USB; o Creator não instala o sistema no SSD ou HD interno.\n\nSe o USB não aparecer, verifique no firmware se a inicialização por USB está habilitada e tente outra porta USB.",
	msgTargetUnnamed:             "Sem nome",
	msgVersionUpdated:            "atualizado",
	msgRefreshSearching:          "Procurando pendrives…",
	msgRefreshHint:               "Atualizando a lista de dispositivos USB disponíveis. Seus discos internos continuam fora da seleção do Creator.",
	msgHeaderTitle:               "Criar pendrive OrdaX",
	msgHeaderSubtitle:            "Assistente guiado: conecte o USB, confirme o destino e acompanhe a criação até a verificação final.",
	msgFieldUSB:                  "Pendrive",
	msgFieldLanguage:             "Idioma",
	msgUpdateChecking:            "Procurando…",
	msgUpdateControl:             "Atualizações",
	msgProgressStartingStatus:    "Iniciando gravação elevada…",
	msgProgressStartingHint:      "O Creator abriu o backend autorizado e está iniciando as verificações finais.",
	msgProgressElevationStatus:   "Confirmando autorização do Windows…",
	msgProgressElevationHint:     "A operação destrutiva só continua dentro do processo elevado autorizado.",
	msgProgressTargetStatus:      "Confirmando o pendrive selecionado…",
	msgProgressTargetHint:        "O Creator está conferindo novamente a identidade física do USB antes de qualquer escrita.",
	msgProgressImageStatus:       "Validando a imagem preparada…",
	msgProgressValidationBytes:   "Validação: {completed} de {total} MiB.",
	msgProgressPlanningStatus:    "Planejando a gravação otimizada…",
	msgProgressPlanningHint:      "O Creator está validando GPT, regiões necessárias e os limites exatos do dispositivo.",
	msgProgressLockStatus:        "Reservando o pendrive com segurança…",
	msgProgressLockHint:          "Os volumes do USB estão sendo bloqueados antes da escrita RAW.",
	msgProgressWritingStatus:     "Gravando OrdaX no pendrive…",
	msgProgressWritingBytes:      "Gravação: {completed} de {total} MiB.",
	msgProgressFlushStatus:       "Sincronizando dados com o pendrive…",
	msgProgressFlushHint:         "Os dados gravados estão sendo enviados ao dispositivo antes da leitura de verificação.",
	msgProgressVerifyingStatus:   "Verificando a gravação por leitura…",
	msgProgressVerifyingBytes:    "Verificação: {completed} de {total} MiB.",
	msgProgressVerifiedStatus:    "Gravação verificada com sucesso…",
	msgProgressVerifiedHint:      "As regiões gravadas conferem com os hashes calculados durante a escrita.",
	msgProgressDataStatus:        "Preparando ORDAX-DATA…",
	msgProgressDataHint:          "O espaço restante está sendo formatado em exFAT e validado para uso normal no Windows.",
	msgProgressCompleteStatus:    "Concluindo criação do pendrive…",
	msgProgressCompleteHint:      "Gravação, verificação e ORDAX-DATA foram concluídos.",
	msgVersionChecking:           "verificando versão…",
	msgVersionAvailable:          "disponível",
	msgRefreshFailedDetail:       "Não foi possível atualizar a lista segura de dispositivos USB. Tente novamente; nenhum disco foi alterado.",
	msgPhysicalWriteFailedDetail: "A criação foi interrompida antes de concluir com segurança. O diagnóstico técnico foi preservado para análise.",
	msgTargetSelectionFailed:     "O destino USB selecionado não está disponível ou não passou pela política de segurança. Recarregue a lista e selecione novamente.",
	msgWriteCompleteStatus:       "Pendrive OrdaX criado e verificado.",
	msgWriteCompleteDialogTitle:  "OrdaX Creator — Tudo pronto",
	msgWriteCompleteDialogBody:   "O pendrive OrdaX foi criado, passou pela verificação de leitura e o espaço ORDAX-DATA foi preparado em exFAT.",
	msgWriteErrorDialogTitle:     "OrdaX Creator — Não foi possível continuar",
	msgWriteBusyDetail:           "Não feche o Creator nem remova o USB até a operação terminar.",
	msgWriteConfirmTitle:         "Confirmar criação do pendrive",
	msgWriteConfirmBody:          "{title}\n\n{body}\n\nTodos os dados deste pendrive serão apagados.\n\nDispositivo: {device}\nNome: {name}\nDisco: {disk}\nTamanho: {size}\nSerial: {serial}\n\n{detail}\n\nDeseja criar o pendrive OrdaX?",
	msgWritePreparingStatus:      "Preparando o pendrive OrdaX…",
	msgWritePreparingHint:        "A imagem oficial está sendo validada e preparada para o tamanho exato do USB selecionado.",
	msgUpdateDevChannelBody:      "Este build usa o canal de desenvolvimento. O Creator gravável possui o canal de atualização próprio.",
	msgUpdateAvailableTitle:      "Atualização disponível",
	msgUpdateAvailableAction:     "Atualização disponível",
	msgUpdateFailedBody:          "Não foi possível concluir a atualização. A versão atual permanece preservada.",
	msgUpdateCurrentBody:         "Você já está usando a versão mais recente do OrdaX Creator.",
	msgUpdateBundleManualBody:    "Há uma nova versão no bundle oficial do OrdaX Creator. Este canal ainda não permite atualização automática dentro do app; baixe o novo OrdaX-Creator-Owner-Prototype.zip da release oficial e substitua o bundle extraído completo. Não substitua apenas o EXE da interface.",
	msgPortablePlanStatus:        "Validando o plano Portable…",
	msgPortablePlanHint:          "O Creator Core está vinculando o layout e os 17 artefatos assinados ao USB selecionado.",
	msgPortableElevationHint:     "Confirme o Controle de Conta de Usuário. O helper elevado revalidará o USB, os 17 sources e o plano antes da primeira escrita.",
	msgPortableVerifiedHint:      "GPT, ORDAX-ESP, ORDAX-DATA e os 17 artefatos passaram pela verificação de leitura.",
}

var creatorENUSMessages = map[creatorMessageID]string{
	msgExperienceErrorEyebrow:    "Your attention is needed",
	msgExperienceErrorTitle:      "Unable to continue",
	msgExperienceErrorBody:       "Creator stopped the process before doing anything unsafe.",
	msgActionRetry:               "Try again",
	msgActionClose:               "Close",
	msgCompleteEyebrow:           "All set",
	msgCompleteTitle:             "Your OrdaX USB is ready",
	msgCompleteBody:              "The USB drive was prepared and verified. You can now restart the computer and boot from USB.",
	msgCompleteDetail:            "If the computer does not boot from the USB drive automatically, open the machine's boot menu and choose the USB device.",
	msgActionFinish:              "Finish",
	msgActionBootHelp:            "How to boot from USB",
	msgCreatingEyebrow:           "Creating the OrdaX USB",
	msgCreatingTitle:             "Do not remove the USB drive",
	msgCreatingBody:              "Creator is preparing, writing, and verifying OrdaX automatically.",
	msgCreatingDetail:            "Final verification rereads the written data to confirm integrity before completion.",
	msgConnectEyebrow:            "Step 1 of 4",
	msgConnectTitle:              "Connect a USB drive",
	msgConnectBody:               "Use a USB drive that can be erased. Creator automatically finds compatible USB devices.",
	msgConnectDetail:             "Internal computer disks are never offered as Creator targets.",
	msgActionReloadUSB:           "Refresh USB",
	msgSelectEyebrow:             "Step 2 of 4",
	msgSelectTitle:               "Choose the USB drive",
	msgSelectBody:                "Check the name and capacity before continuing. Only the selected USB drive can be erased.",
	msgSelectDetail:              "Creator revalidates the device identity again before writing.",
	msgActionContinue:            "Continue",
	msgBlockedEyebrow:            "Creation unavailable",
	msgBlockedTitle:              "This Creator cannot write the USB yet",
	msgBlockedBody:               "The USB drive was detected safely, but this Creator channel is not physically authorized to create Stable/MVP media.",
	msgBlockedDetail:             "No changes were made to the USB drive.",
	msgActionReload:              "Refresh",
	msgReviewEyebrow:             "Step 3 of 4",
	msgReviewTitle:               "Review before creating",
	msgReviewBody:                "The selected USB drive will be erased and prepared to run OrdaX directly from USB.",
	msgReviewDetail:              "Creator does not install anything on the internal SSD or hard drive. After confirmation, Windows will still request administrative authorization (UAC).",
	msgActionCreate:              "Create OrdaX",
	msgActionBack:                "Back",
	msgBootHelp:                  "How to boot from the OrdaX USB\n\n1. Keep the OrdaX USB drive connected to the computer.\n2. Restart the computer.\n3. Open the machine's boot/UEFI menu. The key varies by manufacturer.\n4. Choose the USB/UEFI device that corresponds to the OrdaX USB drive.\n5. OrdaX starts directly from USB; Creator does not install the system on the internal SSD or hard drive.\n\nIf the USB device does not appear, check the firmware settings to ensure USB boot is enabled and try another USB port.",
	msgTargetUnnamed:             "Unnamed",
	msgVersionUpdated:            "updated",
	msgRefreshSearching:          "Searching for USB drives…",
	msgRefreshHint:               "Refreshing the list of available USB devices. Internal disks remain outside Creator's target selection.",
	msgHeaderTitle:               "Create an OrdaX USB drive",
	msgHeaderSubtitle:            "Guided assistant: connect the USB drive, confirm the target, and follow creation through final verification.",
	msgFieldUSB:                  "USB drive",
	msgFieldLanguage:             "Language",
	msgUpdateChecking:            "Checking…",
	msgUpdateControl:             "Updates",
	msgProgressStartingStatus:    "Starting elevated write…",
	msgProgressStartingHint:      "Creator opened the authorized backend and is starting the final checks.",
	msgProgressElevationStatus:   "Confirming Windows authorization…",
	msgProgressElevationHint:     "The destructive operation only continues inside the authorized elevated process.",
	msgProgressTargetStatus:      "Confirming the selected USB drive…",
	msgProgressTargetHint:        "Creator is rechecking the physical identity of the USB device before any write.",
	msgProgressImageStatus:       "Validating the prepared image…",
	msgProgressValidationBytes:   "Validation: {completed} of {total} MiB.",
	msgProgressPlanningStatus:    "Planning the optimized write…",
	msgProgressPlanningHint:      "Creator is validating GPT, required regions, and the exact device boundaries.",
	msgProgressLockStatus:        "Reserving the USB drive safely…",
	msgProgressLockHint:          "USB volumes are being locked before RAW writing.",
	msgProgressWritingStatus:     "Writing OrdaX to the USB drive…",
	msgProgressWritingBytes:      "Write: {completed} of {total} MiB.",
	msgProgressFlushStatus:       "Synchronizing data to the USB drive…",
	msgProgressFlushHint:         "Written data is being flushed to the device before verification reads begin.",
	msgProgressVerifyingStatus:   "Verifying the write by reading it back…",
	msgProgressVerifyingBytes:    "Verification: {completed} of {total} MiB.",
	msgProgressVerifiedStatus:    "Write verified successfully…",
	msgProgressVerifiedHint:      "The written regions match the hashes calculated during the write.",
	msgProgressDataStatus:        "Preparing ORDAX-DATA…",
	msgProgressDataHint:          "Remaining space is being formatted as exFAT and validated for normal Windows use.",
	msgProgressCompleteStatus:    "Finishing USB creation…",
	msgProgressCompleteHint:      "Writing, verification, and ORDAX-DATA preparation are complete.",
	msgVersionChecking:           "checking version…",
	msgVersionAvailable:          "available",
	msgRefreshFailedDetail:       "Unable to refresh the safe USB device list. Try again; no disk was changed.",
	msgPhysicalWriteFailedDetail: "Creation stopped before it could finish safely. The technical diagnostic was preserved for analysis.",
	msgTargetSelectionFailed:     "The selected USB target is unavailable or did not pass the safety policy. Refresh the list and select it again.",
	msgWriteCompleteStatus:       "OrdaX USB created and verified.",
	msgWriteCompleteDialogTitle:  "OrdaX Creator — All set",
	msgWriteCompleteDialogBody:   "The OrdaX USB was created, passed read-back verification, and ORDAX-DATA was prepared as exFAT.",
	msgWriteErrorDialogTitle:     "OrdaX Creator — Unable to continue",
	msgWriteBusyDetail:           "Do not close Creator or remove the USB device until the operation finishes.",
	msgWriteConfirmTitle:         "Confirm USB creation",
	msgWriteConfirmBody:          "{title}\n\n{body}\n\nAll data on this USB drive will be erased.\n\nDevice: {device}\nName: {name}\nDisk: {disk}\nSize: {size}\nSerial: {serial}\n\n{detail}\n\nDo you want to create the OrdaX USB?",
	msgWritePreparingStatus:      "Preparing the OrdaX USB…",
	msgWritePreparingHint:        "The official image is being validated and prepared for the exact size of the selected USB device.",
	msgUpdateDevChannelBody:      "This build uses the development channel. The write-capable Creator has its own update channel.",
	msgUpdateAvailableTitle:      "Update available",
	msgUpdateAvailableAction:     "Update available",
	msgUpdateFailedBody:          "The update could not be completed. The current version remains preserved.",
	msgUpdateCurrentBody:         "You are already using the latest OrdaX Creator version.",
	msgUpdateBundleManualBody:    "A new version is available in the official OrdaX Creator bundle. This channel does not yet allow automatic in-app updates; download the new OrdaX-Creator-Owner-Prototype.zip from the official release and replace the complete extracted bundle. Do not replace only the UI executable.",
	msgPortablePlanStatus:        "Validating the Portable plan…",
	msgPortablePlanHint:          "Creator Core is binding the layout and all 17 signed artifacts to the selected USB device.",
	msgPortableElevationHint:     "Confirm the User Account Control prompt. The elevated helper will revalidate the USB device, all 17 sources, and the plan before the first write.",
	msgPortableVerifiedHint:      "GPT, ORDAX-ESP, ORDAX-DATA, and all 17 artifacts passed read-back verification.",
}

var (
	creatorLocaleMu     sync.RWMutex
	creatorActiveLocale = creatorSourceLocale
)

func creatorSupportedLocales() []creatorLocale {
	return []creatorLocale{creatorLocalePTBR, creatorLocaleENUS}
}

func creatorLocaleDisplayName(locale creatorLocale) string {
	switch locale {
	case creatorLocaleENUS:
		return "English (United States)"
	default:
		return "Português (Brasil)"
	}
}

func resolveCreatorLocale(value string) creatorLocale {
	normalized := strings.TrimSpace(value)
	for _, locale := range creatorSupportedLocales() {
		if strings.EqualFold(normalized, string(locale)) {
			return locale
		}
	}
	language := strings.ToLower(strings.Split(strings.ReplaceAll(normalized, "_", "-"), "-")[0])
	switch language {
	case "en":
		return creatorLocaleENUS
	case "pt":
		return creatorLocalePTBR
	default:
		return creatorSourceLocale
	}
}

func setCreatorLocale(value string) creatorLocale {
	locale := resolveCreatorLocale(value)
	creatorLocaleMu.Lock()
	creatorActiveLocale = locale
	creatorLocaleMu.Unlock()
	return locale
}

func currentCreatorLocale() creatorLocale {
	creatorLocaleMu.RLock()
	defer creatorLocaleMu.RUnlock()
	return creatorActiveLocale
}

func creatorCatalog(locale creatorLocale) map[creatorMessageID]string {
	switch locale {
	case creatorLocaleENUS:
		return creatorENUSMessages
	default:
		return creatorPTBRMessages
	}
}

func creatorMessageFor(locale creatorLocale, id creatorMessageID, values map[string]string) string {
	catalog := creatorCatalog(locale)
	message, ok := catalog[id]
	if !ok {
		message, ok = creatorPTBRMessages[id]
	}
	if !ok {
		return string(id)
	}
	for key, value := range values {
		message = strings.ReplaceAll(message, "{"+key+"}", value)
	}
	return message
}

func creatorT(id creatorMessageID) string {
	return creatorMessageFor(currentCreatorLocale(), id, nil)
}

func creatorTValues(id creatorMessageID, values map[string]string) string {
	return creatorMessageFor(currentCreatorLocale(), id, values)
}

func creatorMessageIDs() []creatorMessageID {
	ids := make([]creatorMessageID, 0, len(creatorPTBRMessages))
	for id := range creatorPTBRMessages {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}
