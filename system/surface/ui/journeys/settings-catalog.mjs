// Localized shared presentation. No account, device or backend authority.
import {translateSurfaceMessage} from '../../../services/i18n/surface.mjs';
import { createJourneyScenarios } from './scenarios.mjs';

export function createSettingsJourneyCatalog(locale='pt-BR') {
 const m=id=>translateSurfaceMessage(locale,id);
 const {settingsTopics}=createJourneyScenarios(locale);
const settingsJourneyTopics = [...settingsTopics,
    { id: 'continuity', name: m("meridian.text.0075"), icon: 'desktop', detail: m("meridian.text.0642"), fields: [{ id: 'continuity', label: m("meridian.text.1078"), value: 'review', options: [{ value: 'local', label: m("meridian.text.0643") }, { value: 'review', label: m("meridian.text.0076") }] }] },
    { id: 'memory', name: m("meridian.text.0644"), icon: 'shield', detail: m("meridian.text.0645"), fields: [{ id: 'memory', label: m("meridian.text.0646"), value: 'ask', options: [{ value: 'ask', label: m("meridian.text.0647") }, { value: 'off', label: m("meridian.text.0079") }] }] },
];
 return {settingsTopics,settingsJourneyTopics};
}

export const {settingsTopics,settingsJourneyTopics}=createSettingsJourneyCatalog();
