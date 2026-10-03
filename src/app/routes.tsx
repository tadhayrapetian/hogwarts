import { ShieldOff } from 'lucide-react';
import type { Permission } from '../core/types';
import { useI18n } from '../i18n';
import { Activity } from '../pages/Activity';
import { AddressBook } from '../pages/AddressBook';
import { Analytics } from '../pages/Analytics';
import { Characters } from '../pages/Characters';
import { Customers } from '../pages/Customers';
import { Dashboard } from '../pages/Dashboard';
import { Houses } from '../pages/Houses';
import { Inventory } from '../pages/Inventory';
import { Mailroom } from '../pages/Mailroom';
import { Production } from '../pages/Production';
import { Shipments } from '../pages/Shipments';
import { Suppliers } from '../pages/Suppliers';
import { OrderDetail } from '../pages/orders/OrderDetail';
import { Orders } from '../pages/orders/Orders';
import { Assembly } from '../pages/print/Assembly';
import { BatchDetail } from '../pages/print/BatchDetail';
import { Batches } from '../pages/print/Batches';
import { ProjectEditor } from '../pages/projects/ProjectEditor';
import { Projects } from '../pages/projects/Projects';
import { Duplicates } from '../pages/recipients/Duplicates';
import { ImportWizard } from '../pages/recipients/ImportWizard';
import { RecipientProfile } from '../pages/recipients/RecipientProfile';
import { Recipients } from '../pages/recipients/Recipients';
import { Settings } from '../pages/settings/Settings';
import { EnvelopeStudio } from '../pages/studio/EnvelopeStudio';
import { PostmarkStudio } from '../pages/studio/PostmarkStudio';
import { SealStudio } from '../pages/studio/SealStudio';
import { StampStudio } from '../pages/studio/StampStudio';
import { TemplateEditor } from '../pages/templates/TemplateEditor';
import { Templates } from '../pages/templates/Templates';
import { EmptyState } from '../ui/kit';
import type { Route } from './router';
import { useSession } from './session';

function Guard({ perm, children }: { perm?: Permission; children: JSX.Element }) {
  const { can } = useSession();
  const { t } = useI18n();
  if (perm && !can(perm)) return <EmptyState icon={<ShieldOff />} title={t('auth.noAccess')} text={t('auth.noAccessHint')} />;
  return children;
}

export function AppRoutes({ route }: { route: Route }) {
  const [a, b, c] = route.path;
  switch (a) {
    case 'recipients':
      if (b === 'import') return <Guard perm="data.import"><ImportWizard /></Guard>;
      if (b === 'duplicates') return <Guard perm="recipients.edit"><Duplicates /></Guard>;
      if (b) return <Guard perm="recipients.view"><RecipientProfile id={b} /></Guard>;
      return <Guard perm="recipients.view"><Recipients /></Guard>;
    case 'customers':
      return <Guard perm="recipients.view"><Customers selectedId={b} /></Guard>;
    case 'addresses':
      return <Guard perm="recipients.view"><AddressBook /></Guard>;
    case 'orders':
      return <Guard perm="orders.view">{b ? <OrderDetail id={b} /> : <Orders />}</Guard>;
    case 'mailroom':
      return <Guard perm="orders.view"><Mailroom /></Guard>;
    case 'projects':
      return <Guard perm="orders.view">{b ? <ProjectEditor id={b} /> : <Projects />}</Guard>;
    case 'production':
      return <Guard perm="orders.view"><Production /></Guard>;
    case 'print':
      if (b && c === 'assembly') return <Guard perm="orders.view"><Assembly batchId={b} /></Guard>;
      return <Guard perm="orders.view">{b ? <BatchDetail id={b} /> : <Batches />}</Guard>;
    case 'assembly':
      return <Guard perm="orders.view"><Assembly projectId={b} /></Guard>;
    case 'shipments':
      return <Guard perm="orders.view"><Shipments /></Guard>;
    case 'templates':
      return <Guard perm="orders.view">{b ? <TemplateEditor id={b} /> : <Templates />}</Guard>;
    case 'studio':
      if (b === 'envelopes') return <Guard perm="orders.view"><EnvelopeStudio id={c} /></Guard>;
      if (b === 'stamps') return <Guard perm="orders.view"><StampStudio /></Guard>;
      if (b === 'postmarks') return <Guard perm="orders.view"><PostmarkStudio /></Guard>;
      if (b === 'seals') return <Guard perm="orders.view"><SealStudio /></Guard>;
      return <Templates />;
    case 'houses':
      return <Guard perm="orders.view"><Houses /></Guard>;
    case 'characters':
      return <Guard perm="orders.view"><Characters /></Guard>;
    case 'inventory':
      return <Guard perm="orders.view"><Inventory /></Guard>;
    case 'suppliers':
      return <Guard perm="orders.view"><Suppliers /></Guard>;
    case 'analytics':
      return <Guard perm="analytics.view"><Analytics /></Guard>;
    case 'activity':
      return <Guard perm="audit.view"><Activity /></Guard>;
    case 'settings':
      return <Settings />;
    default:
      return <Dashboard />;
  }
}
