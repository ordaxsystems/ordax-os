import { mountStorePresentation } from '../../../surface/workspace/components/store/presentation/app.js';
const presentation = mountStorePresentation(document);
import.meta.hot?.dispose(() => presentation.destroy());
