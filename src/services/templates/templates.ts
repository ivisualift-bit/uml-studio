import type { IdGenerator } from '@/domain/ids';
import type { DiagramKind, ProjectDocument } from '@/domain/schemas/project';
import { cloneProjectWithFreshIds } from '@/domain/services/cloneAndRemap';
import type { MessageKey } from '@/i18n';
import { ProjectBuilder } from './builder';

export interface TemplateDef {
  id: string;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  kind: DiagramKind | null;
  build(): ProjectDocument;
}

function library(): ProjectDocument {
  const b = new ProjectBuilder('Library Management', { modelName: 'Library', idPrefix: 'lib' });
  const d = b.diagram('class', 'Library Domain');
  const person = b.node(d, 'class', 'Person', 330, 30, { width: 180, patch: { isAbstract: true } });
  b.attribute(person.elementId, '- name: String').attribute(person.elementId, '- email: String');
  const member = b.node(d, 'class', 'Member', 130, 250, { width: 220 });
  b.attribute(member.elementId, '- memberId: String').attribute(member.elementId, '- joinedOn: Date');
  b.operation(member.elementId, '+ borrow(book: Book): Loan');
  const librarian = b.node(d, 'class', 'Librarian', 520, 250, { width: 230 });
  b.attribute(librarian.elementId, '- employeeId: String');
  b.operation(librarian.elementId, '+ registerMember(member: Member): void');
  const loan = b.node(d, 'class', 'Loan', 130, 480, { width: 220 });
  b.attribute(loan.elementId, '- loanDate: Date')
    .attribute(loan.elementId, '- dueDate: Date')
    .attribute(loan.elementId, '- returned: Boolean = false');
  b.operation(loan.elementId, '+ isOverdue(): Boolean').operation(loan.elementId, '+ close(): void');
  const book = b.node(d, 'class', 'Book', 520, 480, { width: 220 });
  b.attribute(book.elementId, '- isbn: String')
    .attribute(book.elementId, '- title: String')
    .attribute(book.elementId, '- year: Integer');
  b.operation(book.elementId, '+ isAvailable(): Boolean');
  const author = b.node(d, 'class', 'Author', 880, 480, { width: 190 });
  b.attribute(author.elementId, '- name: String').attribute(author.elementId, '- nationality: String');
  b.connect(d, 'generalization', member.viewId, person.viewId);
  b.connect(d, 'generalization', librarian.viewId, person.viewId);
  b.connect(d, 'association', member.viewId, loan.viewId, {
    sourceEnd: { multiplicity: '1' },
    targetEnd: { multiplicity: '0..*', name: 'loans' },
  });
  b.connect(d, 'directedAssociation', loan.viewId, book.viewId, {
    sourceEnd: { multiplicity: '0..*' },
    targetEnd: { multiplicity: '1', name: 'book' },
  });
  b.connect(d, 'association', author.viewId, book.viewId, {
    name: 'writes',
    sourceEnd: { multiplicity: '1..*', name: 'authors' },
    targetEnd: { multiplicity: '*', name: 'books' },
  });
  b.connect(d, 'association', librarian.viewId, loan.viewId, {
    name: 'processes',
    sourceEnd: { multiplicity: '1' },
    targetEnd: { multiplicity: '*' },
  });
  return b.build();
}

function ecommerce(): ProjectDocument {
  const b = new ProjectBuilder('E-Commerce Domain', { modelName: 'Shop', idPrefix: 'shop' });
  const d = b.diagram('class', 'Ordering');
  const customer = b.node(d, 'class', 'Customer', 40, 40, { width: 210 });
  b.attribute(customer.elementId, '- customerId: String')
    .attribute(customer.elementId, '- name: String')
    .attribute(customer.elementId, '- email: String');
  b.operation(customer.elementId, '+ placeOrder(): Order');
  const order = b.node(d, 'class', 'Order', 380, 40, { width: 220 });
  b.attribute(order.elementId, '- orderNumber: String')
    .attribute(order.elementId, '- placedAt: Date')
    .attribute(order.elementId, '- status: OrderStatus');
  b.operation(order.elementId, '+ total(): Money').operation(order.elementId, '+ cancel(): void');
  const item = b.node(d, 'class', 'OrderItem', 380, 320, { width: 220 });
  b.attribute(item.elementId, '- quantity: Integer').attribute(item.elementId, '- unitPrice: Money');
  b.operation(item.elementId, '+ subtotal(): Money');
  const product = b.node(d, 'class', 'Product', 740, 320, { width: 200 });
  b.attribute(product.elementId, '- sku: String')
    .attribute(product.elementId, '- name: String')
    .attribute(product.elementId, '- price: Money');
  const status = b.node(d, 'enumeration', 'OrderStatus', 740, 40, { width: 170 });
  for (const l of ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED']) b.literal(status.elementId, l);
  const payment = b.node(d, 'class', 'Payment', 40, 320, { width: 220, patch: { isAbstract: true } });
  b.attribute(payment.elementId, '- amount: Money').attribute(payment.elementId, '- paidAt: Date');
  b.operation(payment.elementId, '+ authorize(): Boolean', { isAbstract: true });
  const card = b.node(d, 'class', 'CardPayment', 0, 560, { width: 190 });
  b.attribute(card.elementId, '- maskedNumber: String');
  b.operation(card.elementId, '+ authorize(): Boolean');
  const wallet = b.node(d, 'class', 'WalletPayment', 230, 560, { width: 190 });
  b.attribute(wallet.elementId, '- walletId: String');
  b.operation(wallet.elementId, '+ authorize(): Boolean');
  b.connect(d, 'association', customer.viewId, order.viewId, {
    name: 'places',
    sourceEnd: { multiplicity: '1' },
    targetEnd: { multiplicity: '0..*', name: 'orders' },
  });
  b.connect(d, 'composition', order.viewId, item.viewId, {
    sourceEnd: { multiplicity: '1' },
    targetEnd: { multiplicity: '1..*', name: 'items' },
  });
  b.connect(d, 'directedAssociation', item.viewId, product.viewId, {
    sourceEnd: { multiplicity: '*' },
    targetEnd: { multiplicity: '1' },
  });
  b.connect(d, 'association', order.viewId, payment.viewId, {
    sourceEnd: { multiplicity: '1' },
    targetEnd: { multiplicity: '0..1', name: 'payment' },
  });
  b.connect(d, 'dependency', order.viewId, status.viewId);
  b.connect(d, 'generalization', card.viewId, payment.viewId);
  b.connect(d, 'generalization', wallet.viewId, payment.viewId);
  return b.build();
}

function university(): ProjectDocument {
  const b = new ProjectBuilder('University Enrollment', { modelName: 'University', idPrefix: 'uni' });
  const d = b.diagram('useCase', 'Enrollment');
  b.node(d, 'subject', 'University System', 230, 30, { width: 440, height: 560 });
  const register = b.node(d, 'useCase', 'Register for Course', 300, 90, { width: 170, height: 64 });
  const waitlist = b.node(d, 'useCase', 'Join Waitlist', 300, 230, { width: 160, height: 60 });
  const auth = b.node(d, 'useCase', 'Authenticate', 510, 230, { width: 140, height: 60 });
  const grades = b.node(d, 'useCase', 'View Grades', 300, 360, { width: 150, height: 60 });
  const fees = b.node(d, 'useCase', 'Pay Fees', 300, 480, { width: 140, height: 60 });
  const submit = b.node(d, 'useCase', 'Submit Grades', 500, 380, { width: 150, height: 60 });
  const manage = b.node(d, 'useCase', 'Manage Courses', 500, 500, { width: 150, height: 60 });
  b.member(register.elementId, 'extensionPoints', { name: 'course full' });
  const student = b.node(d, 'actor', 'Student', 60, 230);
  const instructor = b.node(d, 'actor', 'Instructor', 790, 340);
  const admin = b.node(d, 'actor', 'Administrator', 790, 500);
  b.connect(d, 'association', student.viewId, register.viewId);
  b.connect(d, 'association', student.viewId, grades.viewId);
  b.connect(d, 'association', student.viewId, fees.viewId);
  b.connect(d, 'association', instructor.viewId, submit.viewId);
  b.connect(d, 'association', admin.viewId, manage.viewId);
  b.connect(d, 'include', register.viewId, auth.viewId);
  b.connect(d, 'include', grades.viewId, auth.viewId);
  b.connect(d, 'include', submit.viewId, auth.viewId);
  const reg = b.doc.modelElements[register.elementId];
  const point = reg?.kind === 'useCase' ? reg.extensionPoints[0]?.id : undefined;
  b.connect(d, 'extend', waitlist.viewId, register.viewId, {
    condition: 'course is full',
    extensionPointIds: point ? [point] : [],
  });
  return b.build();
}

function login(): ProjectDocument {
  const b = new ProjectBuilder('Login Authentication', { modelName: 'Security', idPrefix: 'login' });
  const d = b.diagram('sequence', 'Login', b.root, 'Login');
  const user = b.lifeline(d, 'User', 100, { actor: true });
  const ui = b.lifeline(d, 'ui', 300, { typeName: 'LoginUI' });
  const authSvc = b.lifeline(d, 'auth', 520, { typeName: 'AuthService' });
  const db = b.lifeline(d, 'db', 740, { typeName: 'Database' });
  b.activation(d, ui, 150, 500);
  b.activation(d, authSvc, 190, 450);
  b.activation(d, db, 230, 270);
  b.message(d, user, ui, 'synchronous', 150, 'submitCredentials', 'login, password');
  b.message(d, ui, authSvc, 'synchronous', 190, 'authenticate', 'login, password');
  b.message(d, authSvc, db, 'synchronous', 230, 'findUser', 'login');
  b.message(d, db, authSvc, 'reply', 270, 'userRecord');
  b.message(d, authSvc, authSvc, 'synchronous', 300, 'verifyHash', 'password');
  b.fragment(d, 'alt', { x: 210, y: 345, width: 610, height: 170 }, ['credentials valid', 'else'], [430]);
  b.message(d, authSvc, ui, 'reply', 385, 'session token');
  b.message(d, ui, user, 'asynchronous', 410, 'showDashboard');
  b.message(d, authSvc, ui, 'reply', 465, 'AuthError');
  b.message(d, ui, user, 'asynchronous', 495, 'showError', 'message');
  return b.build();
}

function checkout(): ProjectDocument {
  const b = new ProjectBuilder('Order Checkout', { modelName: 'Shop', idPrefix: 'checkout' });
  const d = b.diagram('sequence', 'Checkout', b.root, 'Checkout');
  const user = b.lifeline(d, 'Shopper', 90, { actor: true });
  const cart = b.lifeline(d, 'cart', 280, { typeName: 'Cart' });
  const orders = b.lifeline(d, 'orders', 480, { typeName: 'OrderService' });
  const gateway = b.lifeline(d, 'gateway', 700, { typeName: 'PaymentGateway' });
  b.activation(d, cart, 150, 520);
  b.activation(d, orders, 190, 500);
  b.activation(d, gateway, 240, 290);
  b.message(d, user, cart, 'synchronous', 150, 'checkout');
  b.message(d, cart, orders, 'synchronous', 190, 'createOrder', 'items');
  b.message(d, orders, orders, 'synchronous', 205, 'reserveStock', 'items');
  b.message(d, orders, gateway, 'synchronous', 245, 'charge', 'amount, card');
  b.message(d, gateway, orders, 'reply', 285, 'paymentResult');
  b.fragment(
    d,
    'alt',
    { x: 200, y: 320, width: 560, height: 200 },
    ['payment approved', 'payment declined'],
    [420],
  );
  b.message(d, orders, cart, 'reply', 360, 'confirmation');
  b.message(d, cart, user, 'asynchronous', 390, 'showReceipt', 'orderNumber');
  b.message(d, orders, cart, 'reply', 460, 'declined');
  b.message(d, cart, user, 'asynchronous', 490, 'showPaymentError');
  return b.build();
}

function loanRequest(): ProjectDocument {
  const b = new ProjectBuilder('Loan Request', { modelName: 'Banking', idPrefix: 'loan' });
  const d = b.diagram('activity', 'Loan Request', b.root, 'Process Loan Request');
  b.node(d, 'activityPartition', 'Applicant', 0, 0, { width: 260, height: 820 });
  b.node(d, 'activityPartition', 'Loan Officer', 260, 0, { width: 300, height: 820 });
  b.node(d, 'activityPartition', 'Credit System', 560, 0, { width: 260, height: 820 });
  const start = b.node(d, 'controlNode', 'start', 118, 60, { subKind: 'initial' });
  const submit = b.node(d, 'action', 'Submit application', 65, 120, { width: 130 });
  const check = b.node(d, 'action', 'Check credit score', 625, 120, { width: 130 });
  const scoreOk = b.node(d, 'controlNode', '', 672, 230, { subKind: 'decision' });
  const review = b.node(d, 'action', 'Review application', 345, 320, { width: 130 });
  const decide = b.node(d, 'controlNode', '', 392, 430, { subKind: 'decision' });
  const approve = b.node(d, 'action', 'Approve loan', 290, 520, { width: 110 });
  const reject = b.node(d, 'action', 'Reject application', 430, 520, { width: 120 });
  const merge = b.node(d, 'controlNode', '', 392, 620, { subKind: 'merge' });
  const notify = b.node(d, 'action', 'Receive decision', 65, 610, { width: 130 });
  const end = b.node(d, 'controlNode', 'end', 117, 730, { subKind: 'activityFinal', width: 26, height: 26 });
  b.connect(d, 'controlFlow', start.viewId, submit.viewId);
  b.connect(d, 'controlFlow', submit.viewId, check.viewId);
  b.connect(d, 'controlFlow', check.viewId, scoreOk.viewId);
  b.connect(d, 'controlFlow', scoreOk.viewId, review.viewId, { guard: 'score >= 650' });
  const low = b.connect(d, 'controlFlow', scoreOk.viewId, reject.viewId, { guard: 'score < 650' });
  b.waypoints(d, low.edgeViewId, [{ x: 690, y: 545 }]);
  b.connect(d, 'controlFlow', review.viewId, decide.viewId);
  b.connect(d, 'controlFlow', decide.viewId, approve.viewId, { guard: 'approved' });
  b.connect(d, 'controlFlow', decide.viewId, reject.viewId, { guard: 'rejected' });
  b.connect(d, 'controlFlow', approve.viewId, merge.viewId);
  b.connect(d, 'controlFlow', reject.viewId, merge.viewId);
  b.connect(d, 'controlFlow', merge.viewId, notify.viewId);
  b.connect(d, 'controlFlow', notify.viewId, end.viewId);
  return b.build();
}

function ticket(): ProjectDocument {
  const b = new ProjectBuilder('Ticket Lifecycle', { modelName: 'Helpdesk', idPrefix: 'ticket' });
  const d = b.diagram('stateMachine', 'Ticket', b.root, 'Ticket');
  const init = b.node(d, 'pseudostate', '', 40, 80, { subKind: 'initial' });
  const fresh = b.node(d, 'state', 'New', 120, 60, { width: 120, height: 60 });
  // Gaps leave room for the transition labels between states.
  const assigned = b.node(d, 'state', 'Assigned', 500, 60, { width: 130, height: 60 });
  const progress = b.node(d, 'state', 'In Progress', 760, 50, {
    width: 170,
    height: 90,
    patch: { entry: 'startTimer', exit: 'stopTimer' },
  });
  const resolved = b.node(d, 'state', 'Resolved', 770, 290, { width: 150, height: 60 });
  const closed = b.node(d, 'state', 'Closed', 440, 290, { width: 130, height: 60 });
  const fin = b.node(d, 'finalState', '', 260, 307);
  b.connect(d, 'transition', init.viewId, fresh.viewId);
  b.connect(d, 'transition', fresh.viewId, assigned.viewId, {
    trigger: 'assign',
    guard: 'agentAvailable',
    effect: 'notifyAgent',
  });
  b.connect(d, 'transition', assigned.viewId, progress.viewId, { trigger: 'start' });
  b.connect(d, 'transition', progress.viewId, resolved.viewId, { trigger: 'resolve', effect: 'sendSurvey' });
  const reopen = b.connect(d, 'transition', resolved.viewId, progress.viewId, { trigger: 'reopen' });
  b.waypoints(d, reopen.edgeViewId, [
    { x: 1060, y: 320 },
    { x: 1060, y: 95 },
  ]);
  b.connect(d, 'transition', resolved.viewId, closed.viewId, {
    trigger: 'close',
    guard: 'customerConfirmed',
  });
  b.connect(d, 'transition', fresh.viewId, closed.viewId, { trigger: 'reject', effect: 'notifyCustomer' });
  b.connect(d, 'transition', closed.viewId, fin.viewId);
  return b.build();
}

function microservices(): ProjectDocument {
  const b = new ProjectBuilder('Microservices Architecture', { modelName: 'Platform', idPrefix: 'ms' });
  const d = b.diagram('component', 'Services');
  const web = b.node(d, 'component', 'Web Frontend', 40, 40, { width: 190 });
  const gateway = b.node(d, 'component', 'API Gateway', 330, 40, { width: 190 });
  const orders = b.node(d, 'component', 'Order Service', 40, 300, { width: 190 });
  const inventory = b.node(d, 'component', 'Inventory Service', 330, 300, { width: 200 });
  const payments = b.node(d, 'component', 'Payment Service', 640, 300, { width: 200 });
  const iOrders = b.node(d, 'interface', 'IOrders', 110, 190, { width: 60, height: 44 });
  const iInventory = b.node(d, 'interface', 'IInventory', 405, 190, { width: 70, height: 44 });
  const iPayments = b.node(d, 'interface', 'IPayments', 710, 190, { width: 70, height: 44 });
  // Provided interfaces in lollipop (ball) notation.
  for (const id of [iOrders.viewId, iInventory.viewId, iPayments.viewId])
    b.viewPatch(d, id, { variant: 'alternate' });
  b.connect(d, 'usage', web.viewId, gateway.viewId);
  b.connect(d, 'realization', orders.viewId, iOrders.viewId);
  b.connect(d, 'realization', inventory.viewId, iInventory.viewId);
  b.connect(d, 'realization', payments.viewId, iPayments.viewId);
  b.connect(d, 'usage', gateway.viewId, iOrders.viewId);
  b.connect(d, 'usage', gateway.viewId, iInventory.viewId);
  b.connect(d, 'usage', orders.viewId, iPayments.viewId);
  return b.build();
}

function cloud(): ProjectDocument {
  const b = new ProjectBuilder('Cloud Deployment', { modelName: 'Deployment', idPrefix: 'cloud' });
  const d = b.diagram('deployment', 'Production');
  const laptop = b.node(d, 'node', 'User Laptop', 30, 60, { subKind: 'device', width: 180, height: 100 });
  const lb = b.node(d, 'node', 'Load Balancer', 300, 60, { width: 180, height: 100 });
  const app = b.node(d, 'node', 'App Server', 560, 20, { width: 300, height: 220 });
  b.node(d, 'node', 'JVM 21', 580, 80, { subKind: 'executionEnvironment', width: 260, height: 140 });
  b.node(d, 'artifact', 'orders-service.jar', 600, 150, { width: 200, height: 50 });
  const dbHost = b.node(d, 'node', 'Database Server', 560, 320, { width: 300, height: 200 });
  b.node(d, 'node', 'PostgreSQL 16', 580, 380, { subKind: 'executionEnvironment', width: 260, height: 120 });
  b.connect(d, 'communicationPath', laptop.viewId, lb.viewId, { stereotype: 'HTTPS' });
  b.connect(d, 'communicationPath', lb.viewId, app.viewId, { stereotype: 'HTTP' });
  b.connect(d, 'communicationPath', app.viewId, dbHost.viewId, { stereotype: 'JDBC' });
  return b.build();
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'library',
    nameKey: 'templates.library.name',
    descriptionKey: 'templates.library.description',
    kind: 'class',
    build: library,
  },
  {
    id: 'ecommerce',
    nameKey: 'templates.ecommerce.name',
    descriptionKey: 'templates.ecommerce.description',
    kind: 'class',
    build: ecommerce,
  },
  {
    id: 'university',
    nameKey: 'templates.university.name',
    descriptionKey: 'templates.university.description',
    kind: 'useCase',
    build: university,
  },
  {
    id: 'login',
    nameKey: 'templates.login.name',
    descriptionKey: 'templates.login.description',
    kind: 'sequence',
    build: login,
  },
  {
    id: 'checkout',
    nameKey: 'templates.checkout.name',
    descriptionKey: 'templates.checkout.description',
    kind: 'sequence',
    build: checkout,
  },
  {
    id: 'loan',
    nameKey: 'templates.loan.name',
    descriptionKey: 'templates.loan.description',
    kind: 'activity',
    build: loanRequest,
  },
  {
    id: 'ticket',
    nameKey: 'templates.ticket.name',
    descriptionKey: 'templates.ticket.description',
    kind: 'stateMachine',
    build: ticket,
  },
  {
    id: 'microservices',
    nameKey: 'templates.microservices.name',
    descriptionKey: 'templates.microservices.description',
    kind: 'component',
    build: microservices,
  },
  {
    id: 'cloud',
    nameKey: 'templates.cloud.name',
    descriptionKey: 'templates.cloud.description',
    kind: 'deployment',
    build: cloud,
  },
];

const cache = new Map<string, ProjectDocument>();

/** Fresh project from a template: deep clone with brand-new identifiers and timestamps. */
export function instantiateTemplate(id: string, ids: IdGenerator, now: Date, name?: string): ProjectDocument {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`Unknown template ${id}`);
  let source = cache.get(id);
  if (!source) {
    source = template.build();
    cache.set(id, source);
  }
  const clone = cloneProjectWithFreshIds(source, ids);
  const stamp = now.toISOString();
  return { ...clone, name: name ?? clone.name, createdAt: stamp, updatedAt: stamp };
}
