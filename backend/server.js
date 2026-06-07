const express = require('express');
const crypto = require('crypto');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');

loadEnvFile(path.join(__dirname, '.env'));

const PORT = 8084;
const app = express();
const DB_PATH = path.join(__dirname, 'db.json');
const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_COOKIE = 'glysteri_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const ALLOWED_ORIGINS = new Set([
  'http://localhost:8083',
  'http://127.0.0.1:4200',
  'http://10.10.11.15:8083'
]);
const sessions = new Map();

function loadEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return;
  }

  const lines = fsSync.readFileSync(filePath, 'utf8').split(/\r?\n/);

  lines.forEach((line) => {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      return;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex === -1) {
      return;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

async function readDb() {
  const data = await fs.readFile(DB_PATH, 'utf8');
  return normalizeDb(JSON.parse(data));
}

async function writeDb(db) {
  await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
}

function getNextId(items) {
  return items.length > 0 ? Math.max(...items.map((item) => item.id)) + 1 : 1;
}

function roundAmount(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function normalizePaymentType(value) {
  return value === 'card' ? 'card' : 'cash';
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, cookie) => {
    const [name, ...valueParts] = cookie.trim().split('=');

    if (name) {
      cookies[name] = decodeURIComponent(valueParts.join('='));
    }

    return cookies;
  }, {});
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''));
  const rightBuffer = Buffer.from(String(right ?? ''));

  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

function isValidSession(req) {
  const token = getSessionToken(req);
  const expiresAt = token ? sessions.get(token) : undefined;

  if (!token || !expiresAt) {
    return false;
  }

  if (expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }

  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return true;
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  });
}

function requireAuth(req, res, next) {
  if (isValidSession(req)) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
}

function normalizeDb(db) {
  db.warehouse = normalizeWarehouse(db.warehouse);
  db.employees = Array.isArray(db.employees) ? db.employees : [];
  db.employeePayments = Array.isArray(db.employeePayments) ? db.employeePayments : [];
  db.dailyIncome = Array.isArray(db.dailyIncome) ? db.dailyIncome : [];
  db.expenses = Array.isArray(db.expenses) ? db.expenses : [];

  db.suppliers.forEach((supplier) => {
    supplier.openAmount = roundAmount(supplier.openAmount);
    supplier.paidAmount = roundAmount(supplier.paidAmount);
  });

  db.invoices.forEach((invoice) => {
    invoice.invoiceNumber = invoice.invoiceNumber || String(invoice.id);
    invoice.date = invoice.date || '';
    invoice.amount = roundAmount(invoice.amount);
    invoice.openAmount = roundAmount(invoice.openAmount);
    invoice.paidAmount = roundAmount(invoice.paidAmount);
  });

  db.payments.forEach((payment) => {
    payment.date = payment.date || '';
    payment.amount = roundAmount(payment.amount);
  });

  db.employees.forEach((employee) => {
    employee.name = String(employee.name || '').trim();
    employee.dayRate = roundAmount(employee.dayRate || 0);
    employee.workedDays = roundAmount(employee.workedDays || 0);
    employee.paymentIds = Array.isArray(employee.paymentIds) ? employee.paymentIds : [];
  });

  db.employeePayments.forEach((payment) => {
    payment.date = payment.date || '';
    payment.type = normalizePaymentType(payment.type);
    payment.amount = roundAmount(payment.amount);
  });

  db.dailyIncome.forEach((income) => {
    income.date = income.date || '';
    income.cashAmount = roundAmount(income.cashAmount || 0);
    income.cardAmount = roundAmount(income.cardAmount || 0);
    income.totalAmount = roundAmount(income.cashAmount + income.cardAmount);
  });

  db.expenses.forEach((expense) => {
    expense.date = expense.date || '';
    expense.description = String(expense.description || '').trim();
    expense.amount = roundAmount(expense.amount || 0);
  });

  recalculateEmployees(db);

  return db;
}

function recalculateEmployees(db) {
  db.employees.forEach((employee) => {
    const paidAmount = db.employeePayments
      .filter((payment) => payment.employeeId === employee.id)
      .reduce((total, payment) => total + Number(payment.amount || 0), 0);

    employee.totalAmount = roundAmount(employee.dayRate * employee.workedDays);
    employee.paidAmount = roundAmount(paidAmount);
    employee.remainingAmount = roundAmount(Math.max(0, employee.totalAmount - employee.paidAmount));
    employee.paymentIds = db.employeePayments
      .filter((payment) => payment.employeeId === employee.id)
      .map((payment) => payment.id);
  });
}

function normalizeWarehouse(warehouse) {
  const normalizedWarehouse = warehouse || {};

  normalizedWarehouse.items = Array.isArray(normalizedWarehouse.items)
    ? normalizedWarehouse.items
    : [];
  normalizedWarehouse.entries = Array.isArray(normalizedWarehouse.entries)
    ? normalizedWarehouse.entries
    : [];

  normalizedWarehouse.items.forEach((item) => {
    item.quantity = roundAmount(item.quantity || 0);
  });

  normalizedWarehouse.entries.forEach((entry) => {
    entry.items = Array.isArray(entry.items) ? entry.items : [];
    entry.items.forEach((item) => {
      item.name = String(item.name || '').trim();
      item.quantity = roundAmount(item.quantity || 0);
    });
  });

  return normalizedWarehouse;
}

function findWarehouseItem(warehouse, name) {
  return warehouse.items.find(
    (item) => item.name.toLowerCase() === name.toLowerCase()
  );
}

function normalizeWarehouseEntryItems(items) {
  const itemMap = new Map();

  items.forEach((item) => {
    const name = String(item.name || '').trim();
    const quantity = Number(item.quantity);

    if (!name || !Number.isFinite(quantity) || quantity <= 0) {
      return;
    }

    itemMap.set(name.toLowerCase(), {
      name,
      quantity: roundAmount((itemMap.get(name.toLowerCase())?.quantity || 0) + quantity)
    });
  });

  return [...itemMap.values()];
}

app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (ALLOWED_ORIGINS.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }

  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/login', (req, res) => {
  const password = String(req.body?.password || '');

  if (!safeCompare(password, APP_PASSWORD)) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  const token = createSession();
  setSessionCookie(res, token);
  res.json({ authenticated: true });
});

app.post('/api/auth/logout', (req, res) => {
  const token = getSessionToken(req);

  if (token) {
    sessions.delete(token);
  }

  clearSessionCookie(res);
  res.json({ authenticated: false });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ authenticated: isValidSession(req) });
});

app.use('/api', requireAuth);

app.get('/api/suppliers', async (req, res, next) => {
  try {
    const db = await readDb();
    res.json(db.suppliers);
  } catch (error) {
    next(error);
  }
});

app.get('/api/suppliers/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const supplierId = Number(req.params.id);
    const supplier = db.suppliers.find((item) => item.id === supplierId);

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    const invoices = db.invoices.filter((invoice) =>
      supplier.invoiceIds.includes(invoice.id)
    );
    const payments = db.payments.filter((payment) =>
      supplier.paymentIds.includes(payment.id)
    );

    res.json({ ...supplier, invoices, payments });
  } catch (error) {
    next(error);
  }
});

app.post('/api/suppliers', async (req, res, next) => {
  try {
    const db = await readDb();
    const name = String(req.body.name || '').trim();
    const openAmount = Number(req.body.openAmount || 0);
    const paidAmount = Number(req.body.paidAmount || 0);

    if (!name) {
      res.status(400).json({ error: 'Supplier name is required' });
      return;
    }

    if (!Number.isFinite(openAmount) || openAmount < 0) {
      res.status(400).json({ error: 'Open amount must be 0 or greater' });
      return;
    }

    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      res.status(400).json({ error: 'Paid amount must be 0 or greater' });
      return;
    }

    const supplier = {
      id: getNextId(db.suppliers),
      name,
      openAmount: roundAmount(openAmount),
      paidAmount: roundAmount(paidAmount),
      invoiceIds: [],
      paymentIds: []
    };

    db.suppliers.push(supplier);
    await writeDb(db);

    res.status(201).json(supplier);
  } catch (error) {
    next(error);
  }
});

app.put('/api/suppliers/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const supplierId = Number(req.params.id);
    const supplier = db.suppliers.find((item) => item.id === supplierId);

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    const name = String(req.body.name || '').trim();
    const openAmount = Number(req.body.openAmount);
    const paidAmount = Number(req.body.paidAmount);

    if (!name) {
      res.status(400).json({ error: 'Supplier name is required' });
      return;
    }

    if (!Number.isFinite(openAmount) || openAmount < 0) {
      res.status(400).json({ error: 'Open amount must be 0 or greater' });
      return;
    }

    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      res.status(400).json({ error: 'Paid amount must be 0 or greater' });
      return;
    }

    supplier.name = name;
    supplier.openAmount = roundAmount(openAmount);
    supplier.paidAmount = roundAmount(paidAmount);

    db.invoices.forEach((invoice) => {
      if (invoice.supplierId === supplier.id) {
        invoice.supplierName = supplier.name;
      }
    });

    await writeDb(db);

    res.json(supplier);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/suppliers/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const supplierId = Number(req.params.id);
    const supplierIndex = db.suppliers.findIndex((item) => item.id === supplierId);

    if (supplierIndex === -1) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    db.suppliers.splice(supplierIndex, 1);
    db.invoices = db.invoices.filter((invoice) => invoice.supplierId !== supplierId);
    db.payments = db.payments.filter((payment) => payment.supplierId !== supplierId);

    await writeDb(db);

    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get('/api/invoices', async (req, res, next) => {
  try {
    const db = await readDb();
    res.json(db.invoices);
  } catch (error) {
    next(error);
  }
});

app.get('/api/invoices/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const invoiceId = Number(req.params.id);
    const invoice = db.invoices.find((item) => item.id === invoiceId);

    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    res.json(invoice);
  } catch (error) {
    next(error);
  }
});

app.post('/api/invoices', async (req, res, next) => {
  try {
    const db = await readDb();
    const supplierId = Number(req.body.supplierId);
    const amount = Number(req.body.amount);
    const date = String(req.body.date || '').trim();
    const invoiceNumber = String(req.body.invoiceNumber || '').trim();
    const supplier = db.suppliers.find((item) => item.id === supplierId);

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Invoice amount must be greater than 0' });
      return;
    }

    if (!date) {
      res.status(400).json({ error: 'Invoice date is required' });
      return;
    }

    if (!invoiceNumber) {
      res.status(400).json({ error: 'Invoice number is required' });
      return;
    }

    const invoice = {
      id: getNextId(db.invoices),
      supplierId,
      supplierName: supplier.name,
      invoiceNumber,
      date,
      amount: roundAmount(amount),
      openAmount: roundAmount(supplier.openAmount),
      paidAmount: 0
    };

    invoice.openAmount = roundAmount(invoice.openAmount + amount);
    db.invoices.push(invoice);
    supplier.invoiceIds.push(invoice.id);
    supplier.openAmount = roundAmount(supplier.openAmount + amount);

    await writeDb(db);

    res.status(201).json({ invoice, supplier });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/invoices/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const invoiceId = Number(req.params.id);
    const invoiceIndex = db.invoices.findIndex((item) => item.id === invoiceId);

    if (invoiceIndex === -1) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const [invoice] = db.invoices.splice(invoiceIndex, 1);
    const supplier = db.suppliers.find((item) => item.id === invoice.supplierId);

    if (supplier) {
      supplier.invoiceIds = supplier.invoiceIds.filter((id) => id !== invoice.id);
      supplier.openAmount = roundAmount(Math.max(0, supplier.openAmount - invoice.amount));
    }

    await writeDb(db);

    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get('/api/payments', async (req, res, next) => {
  try {
    const db = await readDb();
    res.json(db.payments);
  } catch (error) {
    next(error);
  }
});

app.get('/api/payments/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const paymentId = Number(req.params.id);
    const payment = db.payments.find((item) => item.id === paymentId);

    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    res.json(payment);
  } catch (error) {
    next(error);
  }
});

app.post('/api/payments', async (req, res, next) => {
  try {
    const db = await readDb();
    const supplierId = Number(req.body.supplierId);
    const amount = Number(req.body.amount);
    const date = String(req.body.date || '').trim();
    const supplier = db.suppliers.find((item) => item.id === supplierId);

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Payment amount must be greater than 0' });
      return;
    }

    if (!date) {
      res.status(400).json({ error: 'Payment date is required' });
      return;
    }

    if (amount > supplier.openAmount) {
      res.status(400).json({ error: 'Payment amount cannot exceed open amount' });
      return;
    }

    const payment = {
      id: getNextId(db.payments),
      supplierId,
      date,
      amount: roundAmount(amount)
    };

    db.payments.push(payment);
    supplier.paymentIds.push(payment.id);
    supplier.paidAmount = roundAmount(supplier.paidAmount + amount);
    supplier.openAmount = roundAmount(supplier.openAmount - amount);

    await writeDb(db);

    res.status(201).json({ payment, supplier });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/payments/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const paymentId = Number(req.params.id);
    const paymentIndex = db.payments.findIndex((item) => item.id === paymentId);

    if (paymentIndex === -1) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    const [payment] = db.payments.splice(paymentIndex, 1);
    const supplier = db.suppliers.find((item) => item.id === payment.supplierId);

    if (supplier) {
      supplier.paymentIds = supplier.paymentIds.filter((id) => id !== payment.id);
      supplier.paidAmount = roundAmount(Math.max(0, supplier.paidAmount - payment.amount));
      supplier.openAmount = roundAmount(supplier.openAmount + payment.amount);
    }

    await writeDb(db);

    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get('/api/warehouse', async (req, res, next) => {
  try {
    const db = await readDb();
    res.json(db.warehouse);
  } catch (error) {
    next(error);
  }
});

app.post('/api/warehouse/entries', async (req, res, next) => {
  try {
    const db = await readDb();
    const type = String(req.body.type || '').trim();
    const date = String(req.body.date || '').trim();
    const items = normalizeWarehouseEntryItems(
      Array.isArray(req.body.items) ? req.body.items : []
    );

    if (type !== 'add' && type !== 'remove') {
      res.status(400).json({ error: 'Warehouse entry type must be add or remove' });
      return;
    }

    if (!date) {
      res.status(400).json({ error: 'Warehouse entry date is required' });
      return;
    }

    if (items.length === 0) {
      res.status(400).json({ error: 'At least one warehouse item is required' });
      return;
    }

    if (type === 'remove') {
      const unavailableItem = items.find((item) => {
        const warehouseItem = findWarehouseItem(db.warehouse, item.name);
        return !warehouseItem || warehouseItem.quantity < item.quantity;
      });

      if (unavailableItem) {
        res.status(400).json({
          error: `Not enough quantity for ${unavailableItem.name}`
        });
        return;
      }
    }

    items.forEach((item) => {
      let warehouseItem = findWarehouseItem(db.warehouse, item.name);

      if (!warehouseItem) {
        warehouseItem = {
          id: getNextId(db.warehouse.items),
          name: item.name,
          quantity: 0
        };
        db.warehouse.items.push(warehouseItem);
      }

      warehouseItem.quantity = type === 'add'
        ? roundAmount(warehouseItem.quantity + item.quantity)
        : roundAmount(warehouseItem.quantity - item.quantity);
    });

    const entry = {
      id: getNextId(db.warehouse.entries),
      type,
      date,
      items
    };

    db.warehouse.entries.push(entry);
    await writeDb(db);

    res.status(201).json({ entry, warehouse: db.warehouse });
  } catch (error) {
    next(error);
  }
});

app.get('/api/employees', async (req, res, next) => {
  try {
    const db = await readDb();
    res.json(db.employees);
  } catch (error) {
    next(error);
  }
});

app.post('/api/employees', async (req, res, next) => {
  try {
    const db = await readDb();
    const name = String(req.body.name || '').trim();
    const dayRate = Number(req.body.dayRate || 0);
    const workedDays = Number(req.body.workedDays || 0);

    if (!name) {
      res.status(400).json({ error: 'Employee name is required' });
      return;
    }

    if (!Number.isFinite(dayRate) || dayRate < 0) {
      res.status(400).json({ error: 'Day rate must be 0 or greater' });
      return;
    }

    if (!Number.isFinite(workedDays) || workedDays < 0) {
      res.status(400).json({ error: 'Worked days must be 0 or greater' });
      return;
    }

    const employee = {
      id: getNextId(db.employees),
      name,
      dayRate: roundAmount(dayRate),
      workedDays: roundAmount(workedDays),
      totalAmount: 0,
      paidAmount: 0,
      remainingAmount: 0,
      paymentIds: []
    };

    db.employees.push(employee);
    recalculateEmployees(db);
    await writeDb(db);

    res.status(201).json(employee);
  } catch (error) {
    next(error);
  }
});

app.put('/api/employees/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const employeeId = Number(req.params.id);
    const employee = db.employees.find((item) => item.id === employeeId);

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const name = String(req.body.name || '').trim();
    const dayRate = Number(req.body.dayRate);
    const workedDays = Number(req.body.workedDays);

    if (!name) {
      res.status(400).json({ error: 'Employee name is required' });
      return;
    }

    if (!Number.isFinite(dayRate) || dayRate < 0) {
      res.status(400).json({ error: 'Day rate must be 0 or greater' });
      return;
    }

    if (!Number.isFinite(workedDays) || workedDays < 0) {
      res.status(400).json({ error: 'Worked days must be 0 or greater' });
      return;
    }

    employee.name = name;
    employee.dayRate = roundAmount(dayRate);
    employee.workedDays = roundAmount(workedDays);

    recalculateEmployees(db);
    await writeDb(db);

    res.json(employee);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/employees/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const employeeId = Number(req.params.id);
    const employeeIndex = db.employees.findIndex((item) => item.id === employeeId);

    if (employeeIndex === -1) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    db.employees.splice(employeeIndex, 1);
    db.employeePayments = db.employeePayments.filter((payment) => payment.employeeId !== employeeId);
    recalculateEmployees(db);
    await writeDb(db);

    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get('/api/employee-payments', async (req, res, next) => {
  try {
    const db = await readDb();
    res.json(db.employeePayments);
  } catch (error) {
    next(error);
  }
});

app.post('/api/employee-payments', async (req, res, next) => {
  try {
    const db = await readDb();
    const employeeId = Number(req.body.employeeId);
    const date = String(req.body.date || '').trim();
    const type = normalizePaymentType(req.body.type);
    const amount = Number(req.body.amount);
    const employee = db.employees.find((item) => item.id === employeeId);

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    if (!date) {
      res.status(400).json({ error: 'Payment date is required' });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Payment amount must be greater than 0' });
      return;
    }

    if (amount > employee.remainingAmount) {
      res.status(400).json({ error: 'Payment amount cannot exceed remaining amount' });
      return;
    }

    const payment = {
      id: getNextId(db.employeePayments),
      employeeId,
      date,
      type,
      amount: roundAmount(amount)
    };

    db.employeePayments.push(payment);
    recalculateEmployees(db);
    await writeDb(db);

    res.status(201).json({ payment, employee });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/employee-payments/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const paymentId = Number(req.params.id);
    const paymentIndex = db.employeePayments.findIndex((item) => item.id === paymentId);

    if (paymentIndex === -1) {
      res.status(404).json({ error: 'Employee payment not found' });
      return;
    }

    db.employeePayments.splice(paymentIndex, 1);
    recalculateEmployees(db);
    await writeDb(db);

    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get('/api/daily-income', async (req, res, next) => {
  try {
    const db = await readDb();
    res.json(db.dailyIncome);
  } catch (error) {
    next(error);
  }
});

app.post('/api/daily-income', async (req, res, next) => {
  try {
    const db = await readDb();
    const date = String(req.body.date || '').trim();
    const cashAmount = Number(req.body.cashAmount || 0);
    const cardAmount = Number(req.body.cardAmount || 0);

    if (!date) {
      res.status(400).json({ error: 'Income date is required' });
      return;
    }

    if (!Number.isFinite(cashAmount) || cashAmount < 0) {
      res.status(400).json({ error: 'Cash amount must be 0 or greater' });
      return;
    }

    if (!Number.isFinite(cardAmount) || cardAmount < 0) {
      res.status(400).json({ error: 'Card amount must be 0 or greater' });
      return;
    }

    if (cashAmount === 0 && cardAmount === 0) {
      res.status(400).json({ error: 'At least one income amount is required' });
      return;
    }

    const income = {
      id: getNextId(db.dailyIncome),
      date,
      cashAmount: roundAmount(cashAmount),
      cardAmount: roundAmount(cardAmount),
      totalAmount: roundAmount(cashAmount + cardAmount)
    };

    db.dailyIncome.push(income);
    await writeDb(db);

    res.status(201).json(income);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/daily-income/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const incomeId = Number(req.params.id);
    const incomeIndex = db.dailyIncome.findIndex((item) => item.id === incomeId);

    if (incomeIndex === -1) {
      res.status(404).json({ error: 'Daily income not found' });
      return;
    }

    db.dailyIncome.splice(incomeIndex, 1);
    await writeDb(db);

    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get('/api/expenses', async (req, res, next) => {
  try {
    const db = await readDb();
    res.json(db.expenses);
  } catch (error) {
    next(error);
  }
});

app.post('/api/expenses', async (req, res, next) => {
  try {
    const db = await readDb();
    const date = String(req.body.date || '').trim();
    const description = String(req.body.description || '').trim();
    const amount = Number(req.body.amount);

    if (!date) {
      res.status(400).json({ error: 'Expense date is required' });
      return;
    }

    if (!description) {
      res.status(400).json({ error: 'Expense description is required' });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Expense amount must be greater than 0' });
      return;
    }

    const expense = {
      id: getNextId(db.expenses),
      date,
      description,
      amount: roundAmount(amount)
    };

    db.expenses.push(expense);
    await writeDb(db);

    res.status(201).json(expense);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/expenses/:id', async (req, res, next) => {
  try {
    const db = await readDb();
    const expenseId = Number(req.params.id);
    const expenseIndex = db.expenses.findIndex((item) => item.id === expenseId);

    if (expenseIndex === -1) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    db.expenses.splice(expenseIndex, 1);
    await writeDb(db);

    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
