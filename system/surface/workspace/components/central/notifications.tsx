import { useEffect, useRef } from 'react';
import { mountNotificationCenterView } from '../../../ui/notification-center-controls.mjs';
import { createSurfaceLocalization } from '../../../../services/i18n/surface.mjs';
import { useWebPreferences } from './preferences-context';

// Web delivery has no authorized adapter yet. Do not synthesize an empty runtime
// or copy Native's device store into an account-scoped notification feed.
export function WebNotificationCenter() {
  const root = useRef<HTMLDivElement>(null);
  const { preferences } = useWebPreferences();
  useEffect(() => {
    if (!root.current) return;
    const localization = createSurfaceLocalization(preferences);
    const view = mountNotificationCenterView(root.current, null, null, { preferences, localization });
    return () => { view.destroy(); localization.dispose(); };
  }, [preferences]);
  return <div className="web-notifications" ref={root}/>;
}
