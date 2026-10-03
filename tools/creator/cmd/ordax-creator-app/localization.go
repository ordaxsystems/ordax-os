package main

import (
	"sort"
	"strings"
	"sync"
)

type creatorLocale string
type creatorMessageID string

const (
	creatorLocalePTBR creatorLocale = "pt-BR"
	creatorLocaleENUS creatorLocale = "en-US"
	creatorSourceLocale              = creatorLocalePTBR
)

const (
	msgExperienceErrorEyebrow creatorMessageID = "creator.experience.error.eyebrow"
	msgExperienceErrorTitle creatorMessageID = "creator.experience.error.title"
	msgExperienceErrorBody creatorMessageID = "creator.experience.error.body"
	msgActionRetry creatorMessageID = "creator.action.retry"
	msgActionClose creatorMessageID = "creator.action.close"
	msgCompleteEyebrow creatorMessageID = "creator.experience.complete.eyebrow"
	msgCompleteTitle creatorMessageID = "creator.experience.complete.title"
	msgCompleteBody creatorMessageID = "creator.experience.complete.body"
	msgCompleteDetail creatorMessageID = "creator.experience.complete.detail"
	msgActionFinish creatorMessageID = "creator.action.finish"
	msgActionBootHelp creatorMessageID = "creator.action.bootHelp"
	msgCreatingEyebrow creatorMessageID = "creator.experience.creating.eyebrow"
	msgCreatingTitle creatorMessageID = "creator.experience.creating.title"
	msgCreatingBody creatorMessageID = "creator.experience.creating.body"
	msgCreatingDetail creatorMessageID = "creator.experience.creating.detail"
	msgConnectEyebrow creatorMessageID = "creator.experience.connect.eyebrow"
	msgConnectTitle creatorMessageID = "creator.experience.connect.title"
	msgConnectBody creatorMessageID = "creator.experience.connect.body"
	msgConnectDetail creatorMessageID = "creator.experience.connect.detail"
	msgActionReloadUSB creatorMessageID = "creator.action.reloadUsb"
	msgSelectEyebrow creatorMessageID = "creator.experience.select.eyebrow"
	msgSelectTitle creatorMessageID = "creator.experience.select.title"
	msgSelectBody creatorMessageID = "creator.experience.select.body"
	msgSelectDetail creatorMessageID = "creator.experience.select.detail"
	msgActionContinue creatorMessageID = "creator.action.continue"
	msgBlockedEyebrow creatorMessageID = "creator.experience.blocked.eyebrow"
	msgBlockedTitle creatorMessageID = "creator.experience.blocked.title"
	msgBlockedBody creatorMessageID = "creator.experience.blocked.body"
	msgBlockedDetail creatorMessageID = "creator.experience.blocked.detail"
	msgActionReload creatorMessageID = "creator.action.reload"
	msgReviewEyebrow creatorMessageID = "creator.experience.review.eyebrow"
	msgReviewTitle creatorMessageID = "creator.experience.review.title"
	msgReviewBody creatorMessageID = "creator.experience.review.body"
	msgReviewDetail creatorMessageID = "creator.experience.review.detail"
	msgActionCreate creatorMessageID = "creator.action.create"
	msgActionBack creatorMessageID = "creator.action.back"
	msgBootHelp creatorMessageID = "creator.bootHelp.body"
	msgTargetUnnamed creatorMessageID = "creator.target.unnamed"
	msgVersionUpdated creatorMessageID = "creator.version.updated"
	msgRefreshSearching creatorMessageID = "creator.refresh.searching"
	msgRefreshHint creatorMessageID = "creator.refresh.hint"
	msgHeaderTitle creatorMessageID = "creator.header.title"
	msgHeaderSubtitle creatorMessageID = "creator.header.subtitle"
	msgFieldUSB creatorMessageID = "creator.field.usb"
	msgUpdateChecking creatorMessageID = "creator.update.checking"
	msgUpdateInstalling creatorMessageID = "creator.update.installing"
	msgUpdateNow creatorMessageID = "creator.update.now"
	msgUpdateControl creatorMessageID = "creator.update.control"
	msgProgressStartingStatus creatorMessageID = "creator.progress.starting.status"
	msgProgressStartingHint creatorMessageID = "creator.progress.starting.hint"
	msgProgressElevationStatus creatorMessageID = "creator.progress.elevation.status"
	msgProgressElevationHint creatorMessageID = "creator.progress.elevation.hint"
	msgProgressTargetStatus creatorMessageID = "creator.progress.target.status"
	msgProgressTargetHint creatorMessageID = "creator.progress.target.hint"
	msgProgressImageStatus creatorMessageID = "creator.progress.image.status"
	msgProgressValidationBytes creatorMessageID = "creator.progress.validation.bytes"
	msgProgressPlanningStatus creatorMessageID = "creator.progress.planning.status"
	msgProgressPlanningHint creatorMessageID = "creator.progress.planning.hint"
	msgProgressLockStatus creatorMessageID = "creator.progress.lock.status"
	msgProgressLockHint creatorMessageID = "creator.progress.lock.hint"
	msgProgressWritingStatus creatorMessageID = "creator.progress.writing.status"
	msgProgressWritingBytes creatorMessageID = "creator.progress.writing.bytes"
	msgProgressFlushStatus creatorMessageID = "creator.progress.flush.status"
	msgProgressFlushHint creatorMessageID = "creator.progress.flush.hint"
	msgProgressVerifyingStatus creatorMessageID = "creator.progress.verifying.status"
	msgProgressVerifyingBytes creatorMessageID = "creator.progress.verifying.bytes"
	msgProgressVerifiedStatus creatorMessageID = "creator.progress.verified.status"
	msgProgressVerifiedHint creatorMessageID = "creator.progress.verified.hint"
	msgProgressDataStatus creatorMessageID = "creator.progress.data.status"
	msgProgressDataHint creatorMessageID = "creator.progress.data.hint"
	msgProgressCompleteStatus creatorMessageID = "creator.progress.complete.status"
	msgProgressCompleteHint creatorMessageID = "creator.progress.complete.hint"
)

var creatorPTBRMessages = map[creatorMessageID]string{
	msgExperienceErrorEyebrow: "Precisamos da sua atenção",
	msgExperienceErrorTitle: "Não foi possível continuar",
	msgExperienceErrorBody: "O Creator interrompeu o processo antes de fazer algo inseguro.",
	msgActionRetry: "Tentar novamente",
	msgActionClose: "Fechar",
	msgCompleteEyebrow: "Tudo pronto",
	msgCompleteTitle: "Seu OrdaX USB foi criado",
	msgCompleteBody: "O pendrive foi preparado e verificado. Agora você pode reiniciar o computador e iniciar pelo USB.",
	msgCompleteDetail: "Se o computador não iniciar pelo pendrive automaticamente, abra o menu de boot da máquina e escolha o USB.",
	msgActionFinish: "Concluir",
	msgActionBootHelp: "Como iniciar pelo USB",
	msgCreatingEyebrow: "Criando o OrdaX USB",
	msgCreatingTitle: "Não remova o pendrive",
	msgCreatingBody: "O Creator está preparando, gravando e verificando o OrdaX automaticamente.",
	msgCreatingDetail: "A verificação final relê os arquivos gravados para confirmar integridade antes de concluir.",
	msgConnectEyebrow: "Etapa 1 de 4",
	msgConnectTitle: "Conecte um pendrive USB",
	msgConnectBody: "Use um pendrive que possa ser apagado. O Creator encontra dispositivos USB compatíveis automaticamente.",
	msgConnectDetail: "Os discos internos do computador não são oferecidos como destino pelo Creator.",
	msgActionReloadUSB: "Recarregar USB",
	msgSelectEyebrow: "Etapa 2 de 4",
	msgSelectTitle: "Escolha o pendrive",
	msgSelectBody: "Confira nome e capacidade antes de continuar. Somente o USB escolhido poderá ser apagado.",
	msgSelectDetail: "O Creator revalida a identidade do dispositivo novamente antes da gravação.",
	msgActionContinue: "Continuar",
	msgBlockedEyebrow: "Criação indisponível",
	msgBlockedTitle: "Este Creator ainda não pode gravar o USB",
	msgBlockedBody: "O pendrive foi detectado com segurança, mas este canal do Creator não possui autorização física para criar uma mídia Stable/MVP.",
	msgBlockedDetail: "Nenhuma alteração foi feita no pendrive.",
	msgActionReload: "Recarregar",
	msgReviewEyebrow: "Etapa 3 de 4",
	msgReviewTitle: "Revise antes de criar",
	msgReviewBody: "O pendrive selecionado será apagado e preparado para executar o OrdaX diretamente pelo USB.",
	msgReviewDetail: "O Creator não instala nada no SSD ou HD interno. Depois da confirmação, o Windows ainda solicitará autorização administrativa (UAC).",
	msgActionCreate: "Criar OrdaX",
	msgActionBack: "Voltar",
	msgBootHelp: "Como iniciar pelo OrdaX USB\n\n1. Deixe o pendrive OrdaX conectado ao computador.\n2. Reinicie o computador.\n3. Abra o menu de boot/UEFI da máquina. A tecla varia conforme o fabricante.\n4. Escolha o dispositivo USB/UEFI correspondente ao pendrive OrdaX.\n5. O OrdaX inicia diretamente pelo USB; o Creator não instala o sistema no SSD ou HD interno.\n\nSe o USB não aparecer, verifique no firmware se a inicialização por USB está habilitada e tente outra porta USB.",
	msgTargetUnnamed: "Sem nome",
	msgVersionUpdated: "atualizado",
	msgRefreshSearching: "Procurando pendrives…",
	msgRefreshHint: "Atualizando a lista de dispositivos USB disponíveis. Seus discos internos continuam fora da seleção do Creator.",
	msgHeaderTitle: "Criar pendrive OrdaX",
	msgHeaderSubtitle: "Assistente guiado: conecte o USB, confirme o destino e acompanhe a criação até a verificação final.",
	msgFieldUSB: "Pendrive",
	msgUpdateChecking: "Procurando…",
	msgUpdateInstalling: "Atualizando…",
	msgUpdateNow: "Atualizar agora",
	msgUpdateControl: "Atualizações",
	msgProgressStartingStatus: "Iniciando gravação elevada…",
	msgProgressStartingHint: "O Creator abriu o backend autorizado e está iniciando as verificações finais.",
	msgProgressElevationStatus: "Confirmando autorização do Windows…",
	msgProgressElevationHint: "A operação destrutiva só continua dentro do processo elevado autorizado.",
	msgProgressTargetStatus: "Confirmando o pendrive selecionado…",
	msgProgressTargetHint: "O Creator está conferindo novamente a identidade física do USB antes de qualquer escrita.",
	msgProgressImageStatus: "Validando a imagem preparada…",
	msgProgressValidationBytes: "Validação: {completed} de {total} MiB.",
	msgProgressPlanningStatus: "Planejando a gravação otimizada…",
	msgProgressPlanningHint: "O Creator está validando GPT, regiões necessárias e os limites exatos do dispositivo.",
	msgProgressLockStatus: "Reservando o pendrive com segurança…",
	msgProgressLockHint: "Os volumes do USB estão sendo bloqueados antes da escrita RAW.",
	msgProgressWritingStatus: "Gravando OrdaX no pendrive…",
	msgProgressWritingBytes: "Gravação: {completed} de {total} MiB.",
	msgProgressFlushStatus: "Sincronizando dados com o pendrive…",
	msgProgressFlushHint: "Os dados gravados estão sendo enviados ao dispositivo antes da leitura de verificação.",
	msgProgressVerifyingStatus: "Verificando a gravação por leitura…",
	msgProgressVerifyingBytes: "Verificação: {completed} de {total} MiB.",
	msgProgressVerifiedStatus: "Gravação verificada com sucesso…",
	msgProgressVerifiedHint: "As regiões gravadas conferem com os hashes calculados durante a escrita.",
	msgProgressDataStatus: "Preparando ORDAX-DATA…",
	msgProgressDataHint: "O espaço restante está sendo formatado em exFAT e validado para uso normal no Windows.",
	msgProgressCompleteStatus: "Concluindo criação do pendrive…",
	msgProgressCompleteHint: "Gravação, verificação e ORDAX-DATA foram concluídos.",
}

var creatorENUSMessages = map[creatorMessageID]string{
	msgExperienceErrorEyebrow: "Your attention is needed",
	msgExperienceErrorTitle: "Unable to continue",
	msgExperienceErrorBody: "Creator stopped the process before doing anything unsafe.",
	msgActionRetry: "Try again",
	msgActionClose: "Close",
	msgCompleteEyebrow: "All set",
	msgCompleteTitle: "Your OrdaX USB is ready",
	msgCompleteBody: "The USB drive was prepared and verified. You can now restart the computer and boot from USB.",
	msgCompleteDetail: "If the computer does not boot from the USB drive automatically, open the machine's boot menu and choose the USB device.",
	msgActionFinish: "Finish",
	msgActionBootHelp: "How to boot from USB",
	msgCreatingEyebrow: "Creating the OrdaX USB",
	msgCreatingTitle: "Do not remove the USB drive",
	msgCreatingBody: "Creator is preparing, writing, and verifying OrdaX automatically.",
	msgCreatingDetail: "Final verification rereads the written data to confirm integrity before completion.",
	msgConnectEyebrow: "Step 1 of 4",
	msgConnectTitle: "Connect a USB drive",
	msgConnectBody: "Use a USB drive that can be erased. Creator automatically finds compatible USB devices.",
	msgConnectDetail: "Internal computer disks are never offered as Creator targets.",
	msgActionReloadUSB: "Refresh USB",
	msgSelectEyebrow: "Step 2 of 4",
	msgSelectTitle: "Choose the USB drive",
	msgSelectBody: "Check the name and capacity before continuing. Only the selected USB drive can be erased.",
	msgSelectDetail: "Creator revalidates the device identity again before writing.",
	msgActionContinue: "Continue",
	msgBlockedEyebrow: "Creation unavailable",
	msgBlockedTitle: "This Creator cannot write the USB yet",
	msgBlockedBody: "The USB drive was detected safely, but this Creator channel is not physically authorized to create Stable/MVP media.",
	msgBlockedDetail: "No changes were made to the USB drive.",
	msgActionReload: "Refresh",
	msgReviewEyebrow: "Step 3 of 4",
	msgReviewTitle: "Review before creating",
	msgReviewBody: "The selected USB drive will be erased and prepared to run OrdaX directly from USB.",
	msgReviewDetail: "Creator does not install anything on the internal SSD or hard drive. After confirmation, Windows will still request administrative authorization (UAC).",
	msgActionCreate: "Create OrdaX",
	msgActionBack: "Back",
	msgBootHelp: "How to boot from the OrdaX USB\n\n1. Keep the OrdaX USB drive connected to the computer.\n2. Restart the computer.\n3. Open the machine's boot/UEFI menu. The key varies by manufacturer.\n4. Choose the USB/UEFI device that corresponds to the OrdaX USB drive.\n5. OrdaX starts directly from USB; Creator does not install the system on the internal SSD or hard drive.\n\nIf the USB device does not appear, check the firmware settings to ensure USB boot is enabled and try another USB port.",
	msgTargetUnnamed: "Unnamed",
	msgVersionUpdated: "updated",
	msgRefreshSearching: "Searching for USB drives…",
	msgRefreshHint: "Refreshing the list of available USB devices. Internal disks remain outside Creator's target selection.",
	msgHeaderTitle: "Create an OrdaX USB drive",
	msgHeaderSubtitle: "Guided assistant: connect the USB drive, confirm the target, and follow creation through final verification.",
	msgFieldUSB: "USB drive",
	msgUpdateChecking: "Checking…",
	msgUpdateInstalling: "Updating…",
	msgUpdateNow: "Update now",
	msgUpdateControl: "Updates",
	msgProgressStartingStatus: "Starting elevated write…",
	msgProgressStartingHint: "Creator opened the authorized backend and is starting the final checks.",
	msgProgressElevationStatus: "Confirming Windows authorization…",
	msgProgressElevationHint: "The destructive operation only continues inside the authorized elevated process.",
	msgProgressTargetStatus: "Confirming the selected USB drive…",
	msgProgressTargetHint: "Creator is rechecking the physical identity of the USB device before any write.",
	msgProgressImageStatus: "Validating the prepared image…",
	msgProgressValidationBytes: "Validation: {completed} of {total} MiB.",
	msgProgressPlanningStatus: "Planning the optimized write…",
	msgProgressPlanningHint: "Creator is validating GPT, required regions, and the exact device boundaries.",
	msgProgressLockStatus: "Reserving the USB drive safely…",
	msgProgressLockHint: "USB volumes are being locked before RAW writing.",
	msgProgressWritingStatus: "Writing OrdaX to the USB drive…",
	msgProgressWritingBytes: "Write: {completed} of {total} MiB.",
	msgProgressFlushStatus: "Synchronizing data to the USB drive…",
	msgProgressFlushHint: "Written data is being flushed to the device before verification reads begin.",
	msgProgressVerifyingStatus: "Verifying the write by reading it back…",
	msgProgressVerifyingBytes: "Verification: {completed} of {total} MiB.",
	msgProgressVerifiedStatus: "Write verified successfully…",
	msgProgressVerifiedHint: "The written regions match the hashes calculated during the write.",
	msgProgressDataStatus: "Preparing ORDAX-DATA…",
	msgProgressDataHint: "Remaining space is being formatted as exFAT and validated for normal Windows use.",
	msgProgressCompleteStatus: "Finishing USB creation…",
	msgProgressCompleteHint: "Writing, verification, and ORDAX-DATA preparation are complete.",
}

var (
	creatorLocaleMu sync.RWMutex
	creatorActiveLocale = creatorSourceLocale
)

func creatorSupportedLocales() []creatorLocale {
	return []creatorLocale{creatorLocalePTBR, creatorLocaleENUS}
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
