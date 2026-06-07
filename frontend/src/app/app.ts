import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';

type Page = 'suppliers' | 'invoices' | 'payments' | 'graph' | 'warehouse' | 'warehouseGraph' | 'employees' | 'incomeOverview';
type DeleteType = 'supplier' | 'invoice' | 'payment' | 'employee' | 'employeePayment' | 'dailyIncome' | 'expense';
type CreateConfirmType = 'invoice' | 'payment';
type EmployeePaymentType = 'cash' | 'card';
type EmployeePaymentTypeFilter = EmployeePaymentType | 'all';

interface Supplier {
  id: number;
  name: string;
  openAmount: number;
  paidAmount: number;
  invoiceIds: number[];
  paymentIds: number[];
}

interface Invoice {
  id: number;
  supplierId: number;
  supplierName: string;
  invoiceNumber: string;
  date: string;
  amount: number;
  openAmount: number;
  paidAmount: number;
}

interface Payment {
  id: number;
  supplierId: number;
  date: string;
  amount: number;
}

type WarehouseEntryType = 'add' | 'remove';

interface WarehouseItem {
  id: number;
  name: string;
  quantity: number;
}

interface WarehouseEntryItem {
  name: string;
  quantity: number;
  useNewName?: boolean;
}

interface WarehouseEntry {
  id: number;
  type: WarehouseEntryType;
  date: string;
  items: WarehouseEntryItem[];
}

interface Warehouse {
  items: WarehouseItem[];
  entries: WarehouseEntry[];
}

interface Employee {
  id: number;
  name: string;
  dayRate: number;
  workedDays: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentIds: number[];
}

interface EmployeePayment {
  id: number;
  employeeId: number;
  date: string;
  type: EmployeePaymentType;
  amount: number;
}

interface DailyIncome {
  id: number;
  date: string;
  cashAmount: number;
  cardAmount: number;
  totalAmount: number;
}

interface Expense {
  id: number;
  date: string;
  description: string;
  amount: number;
}

interface SupplierForm {
  name: string;
  openAmount: number;
  paidAmount: number;
}

interface AmountForm {
  supplierId: number;
  date: string;
  amount: number;
}

interface InvoiceForm extends AmountForm {
  invoiceNumber: string;
}

interface WarehouseEntryForm {
  type: WarehouseEntryType;
  date: string;
  items: WarehouseEntryItem[];
}

interface EmployeeForm {
  name: string;
  dayRate: number;
  workedDays: number;
}

interface EmployeePaymentForm {
  employeeId: number;
  date: string;
  type: EmployeePaymentType;
  amount: number;
}

interface DailyIncomeForm {
  date: string;
  cashAmount: number;
  cardAmount: number;
}

interface ExpenseForm {
  date: string;
  description: string;
  amount: number;
}

interface DeleteTarget {
  type: DeleteType;
  id: number;
  label: string;
}

interface ConfirmRow {
  label: string;
  value: string;
}

interface GraphPoint {
  invoice: Invoice;
  x: number;
  y: number;
}

interface WarehouseGraphPoint {
  entry: WarehouseEntry;
  quantity: number;
  delta: number;
  x: number;
  y: number;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private readonly apiUrl = 'http://10.10.11.15:8084/api';
  private readonly httpOptions = { withCredentials: true };
  readonly chartWidth = 900;
  readonly chartHeight = 320;
  readonly chartPadding = 44;

  pages: Page[] = ['suppliers', 'invoices', 'payments', 'graph', 'warehouse', 'warehouseGraph', 'employees', 'incomeOverview'];
  currentPage: Page = 'suppliers';
  mobileMenuOpen = false;
  isAuthenticated = false;
  isCheckingAuth = true;
  loginPassword = '';
  loginError = '';
  suppliers: Supplier[] = [];
  invoices: Invoice[] = [];
  payments: Payment[] = [];
  warehouse: Warehouse = this.createEmptyWarehouse();
  employees: Employee[] = [];
  employeePayments: EmployeePayment[] = [];
  dailyIncome: DailyIncome[] = [];
  expenses: Expense[] = [];
  newSupplier: SupplierForm = this.createEmptySupplierForm();
  supplierForm: SupplierForm = this.createEmptySupplierForm();
  invoiceForm: InvoiceForm = this.createEmptyInvoiceForm();
  paymentForm: AmountForm = this.createEmptyAmountForm();
  warehouseEntryForm: WarehouseEntryForm = this.createEmptyWarehouseEntryForm();
  employeeForm: EmployeeForm = this.createEmptyEmployeeForm();
  employeePaymentForm: EmployeePaymentForm = this.createEmptyEmployeePaymentForm();
  dailyIncomeForm: DailyIncomeForm = this.createEmptyDailyIncomeForm();
  expenseForm: ExpenseForm = this.createEmptyExpenseForm();
  supplierFilterId = 0;
  invoiceSupplierFilterId = 0;
  paymentSupplierFilterId = 0;
  graphSupplierFilterId = 0;
  warehouseItemFilterId = 0;
  warehouseGraphItemId = 0;
  employeePaymentFilterId = 0;
  employeePaymentTypeFilter: EmployeePaymentTypeFilter = 'all';
  editingEmployee: Employee | null = null;
  editingEmployeeForm: EmployeeForm = this.createEmptyEmployeeForm();
  editingSupplier: Supplier | null = null;
  deleteTarget: DeleteTarget | null = null;
  createConfirmTarget: CreateConfirmType | null = null;
  isLoading = false;
  errorMessage = '';

  constructor(
    private readonly http: HttpClient,
    private readonly changeDetector: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.checkAuth();
  }

  navigate(page: Page): void {
    this.currentPage = page;
    this.errorMessage = '';
    this.closeMobileMenu();
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen = false;
  }

  createSupplier(): void {
    this.http.post<Supplier>(`${this.apiUrl}/suppliers`, this.newSupplier, this.httpOptions).subscribe({
      next: () => {
        this.newSupplier = this.createEmptySupplierForm();
        this.loadData();
      },
      error: () => this.handleError('Could not create supplier.')
    });
  }

  login(): void {
    this.loginError = '';

    this.http
      .post<{ authenticated: boolean }>(
        `${this.apiUrl}/auth/login`,
        { password: this.loginPassword },
        this.httpOptions
      )
      .subscribe({
        next: () => {
          this.isAuthenticated = true;
          this.loginPassword = '';
          this.loadData();
        },
        error: () => {
          this.loginError = 'Wrong password.';
          this.changeDetector.detectChanges();
        }
      });
  }

  logout(): void {
    this.closeMobileMenu();
    this.http.post(`${this.apiUrl}/auth/logout`, {}, this.httpOptions).subscribe({
      next: () => this.clearAuthenticatedState(),
      error: () => this.clearAuthenticatedState()
    });
  }

  openEditSupplier(supplier: Supplier): void {
    this.editingSupplier = supplier;
    this.supplierForm = {
      name: supplier.name,
      openAmount: supplier.openAmount,
      paidAmount: supplier.paidAmount
    };
  }

  closeEditSupplier(): void {
    this.editingSupplier = null;
  }

  updateSupplier(): void {
    if (!this.editingSupplier) {
      return;
    }

    this.http
      .put<Supplier>(
        `${this.apiUrl}/suppliers/${this.editingSupplier.id}`,
        this.supplierForm,
        this.httpOptions
      )
      .subscribe({
        next: () => {
          this.closeEditSupplier();
          this.loadData();
        },
        error: () => this.handleError('Could not update supplier.')
      });
  }

  createInvoice(): void {
    this.createConfirmTarget = 'invoice';
  }

  createPayment(): void {
    this.createConfirmTarget = 'payment';
  }

  setWarehouseEntryType(type: WarehouseEntryType): void {
    this.warehouseEntryForm.type = type;
    this.warehouseEntryForm.items = this.warehouseEntryForm.items.map((item) => ({
      name: '',
      quantity: item.quantity,
      useNewName: false
    }));
  }

  closeCreateConfirm(): void {
    this.createConfirmTarget = null;
  }

  confirmCreate(): void {
    if (this.createConfirmTarget === 'invoice') {
      this.confirmCreateInvoice();
      return;
    }

    if (this.createConfirmTarget === 'payment') {
      this.confirmCreatePayment();
    }
  }

  get createConfirmTitle(): string {
    return this.createConfirmTarget === 'invoice' ? 'Confirm invoice' : 'Confirm payment';
  }

  get createConfirmRows(): ConfirmRow[] {
    if (this.createConfirmTarget === 'invoice') {
      return [
        { label: 'Supplier', value: this.getSupplierName(this.invoiceForm.supplierId) },
        { label: 'Date', value: this.invoiceForm.date },
        { label: 'Invoice number', value: this.invoiceForm.invoiceNumber },
        { label: 'Amount', value: this.formatMoney(this.invoiceForm.amount) }
      ];
    }

    return [
      { label: 'Supplier', value: this.getSupplierName(this.paymentForm.supplierId) },
      { label: 'Date', value: this.paymentForm.date },
      { label: 'Amount', value: this.formatMoney(this.paymentForm.amount) }
    ];
  }

  addWarehouseEntryItem(): void {
    this.warehouseEntryForm.items.push(this.createEmptyWarehouseEntryItem());
  }

  removeWarehouseEntryItem(index: number): void {
    if (this.warehouseEntryForm.items.length === 1) {
      this.warehouseEntryForm.items = [this.createEmptyWarehouseEntryItem()];
      return;
    }

    this.warehouseEntryForm.items.splice(index, 1);
  }

  setWarehouseEntryItemName(index: number, value: string): void {
    const item = this.warehouseEntryForm.items[index];

    if (!item) {
      return;
    }

    if (value === '__new__') {
      item.useNewName = true;
      item.name = '';
      return;
    }

    item.useNewName = false;
    item.name = value;
  }

  createWarehouseEntry(): void {
    this.http
      .post(`${this.apiUrl}/warehouse/entries`, this.warehouseEntryForm, this.httpOptions)
      .subscribe({
        next: () => {
          this.warehouseEntryForm = this.createEmptyWarehouseEntryForm();
          this.loadData();
        },
        error: () => this.handleError('Could not create warehouse entry.')
      });
  }

  createEmployee(): void {
    this.http.post<Employee>(`${this.apiUrl}/employees`, this.employeeForm, this.httpOptions).subscribe({
      next: () => {
        this.employeeForm = this.createEmptyEmployeeForm();
        this.loadData();
      },
      error: () => this.handleError('Could not create employee.')
    });
  }

  openEditEmployee(employee: Employee): void {
    this.editingEmployee = employee;
    this.editingEmployeeForm = {
      name: employee.name,
      dayRate: employee.dayRate,
      workedDays: employee.workedDays
    };
  }

  closeEditEmployee(): void {
    this.editingEmployee = null;
  }

  updateEmployee(): void {
    if (!this.editingEmployee) {
      return;
    }

    this.http
      .put<Employee>(
        `${this.apiUrl}/employees/${this.editingEmployee.id}`,
        this.editingEmployeeForm,
        this.httpOptions
      )
      .subscribe({
        next: () => {
          this.closeEditEmployee();
          this.loadData();
        },
        error: () => this.handleError('Could not update employee.')
      });
  }

  createEmployeePayment(): void {
    this.http
      .post(`${this.apiUrl}/employee-payments`, this.employeePaymentForm, this.httpOptions)
      .subscribe({
        next: () => {
          this.employeePaymentForm = this.createEmptyEmployeePaymentForm();
          this.loadData();
        },
        error: () => this.handleError('Could not save employee payment.')
      });
  }

  createDailyIncome(): void {
    this.http.post<DailyIncome>(`${this.apiUrl}/daily-income`, this.dailyIncomeForm, this.httpOptions).subscribe({
      next: () => {
        this.dailyIncomeForm = this.createEmptyDailyIncomeForm();
        this.loadData();
      },
      error: () => this.handleError('Could not save daily income.')
    });
  }

  createExpense(): void {
    this.http.post<Expense>(`${this.apiUrl}/expenses`, this.expenseForm, this.httpOptions).subscribe({
      next: () => {
        this.expenseForm = this.createEmptyExpenseForm();
        this.loadData();
      },
      error: () => this.handleError('Could not save expense.')
    });
  }

  openDelete(type: DeleteType, id: number, label: string): void {
    this.deleteTarget = { type, id, label };
  }

  closeDelete(): void {
    this.deleteTarget = null;
  }

  confirmDelete(): void {
    if (!this.deleteTarget) {
      return;
    }

    const target = this.deleteTarget;
    const endpoint = `${this.apiUrl}/${this.getDeleteEndpoint(target.type)}/${target.id}`;

    this.http.delete<void>(endpoint, this.httpOptions).subscribe({
      next: () => {
        this.closeDelete();
        this.loadData();
      },
      error: () => this.handleError(`Could not delete ${target.type}.`)
    });
  }

  getSupplierName(supplierId: number): string {
    return this.suppliers.find((supplier) => supplier.id === supplierId)?.name ?? `Supplier #${supplierId}`;
  }

  getEmployeeName(employeeId: number): string {
    return this.employees.find((employee) => employee.id === employeeId)?.name ?? `Employee #${employeeId}`;
  }

  getPageLabel(page: Page): string {
    const labels: Record<Page, string> = {
      suppliers: 'Suppliers',
      invoices: 'Invoices',
      payments: 'Payments',
      graph: 'Graph',
      warehouse: 'Warehouse',
      warehouseGraph: 'Warehouse graph',
      employees: 'Employees',
      incomeOverview: 'Income overview'
    };

    return labels[page];
  }

  get employeeTotalOwed(): number {
    return this.employees.reduce((total, employee) => total + employee.totalAmount, 0);
  }

  get employeeTotalPaid(): number {
    return this.employees.reduce((total, employee) => total + employee.paidAmount, 0);
  }

  get employeeTotalRemaining(): number {
    return this.employees.reduce((total, employee) => total + employee.remainingAmount, 0);
  }

  get filteredEmployeePayments(): EmployeePayment[] {
    return this.employeePayments
      .filter((payment) => (
        this.employeePaymentFilterId === 0 || payment.employeeId === this.employeePaymentFilterId
      ))
      .filter((payment) => (
        this.employeePaymentTypeFilter === 'all' || payment.type === this.employeePaymentTypeFilter
      ));
  }

  get filteredEmployeeCashPaymentsTotal(): number {
    return this.sumEmployeePaymentsByType('cash');
  }

  get filteredEmployeeCardPaymentsTotal(): number {
    return this.sumEmployeePaymentsByType('card');
  }

  get filteredEmployeePaymentsTotal(): number {
    return this.filteredEmployeePayments.reduce((total, payment) => total + payment.amount, 0);
  }

  get totalCashIncome(): number {
    return this.dailyIncome.reduce((total, income) => total + income.cashAmount, 0);
  }

  get totalCardIncome(): number {
    return this.dailyIncome.reduce((total, income) => total + income.cardAmount, 0);
  }

  get totalIncome(): number {
    return this.dailyIncome.reduce((total, income) => total + income.totalAmount, 0);
  }

  get totalExpenses(): number {
    return this.expenses.reduce((total, expense) => total + expense.amount, 0);
  }

  get netIncome(): number {
    return this.totalIncome - this.totalExpenses;
  }

  get sortedDailyIncome(): DailyIncome[] {
    return this.dailyIncome.slice().sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id);
  }

  get sortedExpenses(): Expense[] {
    return this.expenses.slice().sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id);
  }

  get filteredSuppliers(): Supplier[] {
    if (this.supplierFilterId === 0) {
      return this.suppliers;
    }

    return this.suppliers.filter((supplier) => supplier.id === this.supplierFilterId);
  }

  get filteredInvoices(): Invoice[] {
    if (this.invoiceSupplierFilterId === 0) {
      return this.invoices;
    }

    return this.invoices.filter((invoice) => invoice.supplierId === this.invoiceSupplierFilterId);
  }

  get filteredPayments(): Payment[] {
    if (this.paymentSupplierFilterId === 0) {
      return this.payments;
    }

    return this.payments.filter((payment) => payment.supplierId === this.paymentSupplierFilterId);
  }

  get filteredWarehouseItems(): WarehouseItem[] {
    if (this.warehouseItemFilterId === 0) {
      return this.warehouse.items;
    }

    return this.warehouse.items.filter((item) => item.id === this.warehouseItemFilterId);
  }

  get graphInvoices(): Invoice[] {
    if (this.graphSupplierFilterId === 0) {
      return [];
    }

    return this.invoices
      .filter((invoice) => invoice.supplierId === this.graphSupplierFilterId)
      .slice()
      .sort((left, right) => left.id - right.id);
  }

  get graphPoints(): GraphPoint[] {
    const invoices = this.graphInvoices;
    const openAmounts = invoices.map((invoice) => invoice.openAmount);
    const minOpenAmount = Math.min(...openAmounts);
    const maxOpenAmount = Math.max(...openAmounts);
    const chartInnerWidth = this.chartWidth - this.chartPadding * 2;
    const chartInnerHeight = this.chartHeight - this.chartPadding * 2;

    return invoices.map((invoice, index) => {
      const x = invoices.length === 1
        ? this.chartWidth / 2
        : this.chartPadding + (index / (invoices.length - 1)) * chartInnerWidth;
      const normalizedY = maxOpenAmount === minOpenAmount
        ? 0.5
        : (invoice.openAmount - minOpenAmount) / (maxOpenAmount - minOpenAmount);
      const y = this.chartHeight - this.chartPadding - normalizedY * chartInnerHeight;

      return { invoice, x, y };
    });
  }

  get graphPolylinePoints(): string {
    return this.graphPoints.map((point) => `${point.x},${point.y}`).join(' ');
  }

  get graphMinOpenAmount(): number {
    const amounts = this.graphInvoices.map((invoice) => invoice.openAmount);
    return amounts.length ? Math.min(...amounts) : 0;
  }

  get graphMaxOpenAmount(): number {
    const amounts = this.graphInvoices.map((invoice) => invoice.openAmount);
    return amounts.length ? Math.max(...amounts) : 0;
  }

  get selectedWarehouseGraphItem(): WarehouseItem | undefined {
    return this.warehouse.items.find((item) => item.id === this.warehouseGraphItemId);
  }

  get warehouseGraphPoints(): WarehouseGraphPoint[] {
    const itemName = this.selectedWarehouseGraphItem?.name.trim().toLowerCase();

    if (!itemName) {
      return [];
    }

    let quantity = 0;
    const matchingEntries = this.warehouse.entries
      .slice()
      .sort((left, right) => {
        const dateOrder = left.date.localeCompare(right.date);
        return dateOrder === 0 ? left.id - right.id : dateOrder;
      })
      .map((entry) => {
        const entryQuantity = entry.items
          .filter((item) => item.name.trim().toLowerCase() === itemName)
          .reduce((total, item) => total + Number(item.quantity || 0), 0);

        if (entryQuantity === 0) {
          return null;
        }

        const delta = entry.type === 'add' ? entryQuantity : -entryQuantity;
        quantity += delta;

        return { entry, quantity, delta };
      })
      .filter((point): point is { entry: WarehouseEntry; quantity: number; delta: number } => point !== null);

    const quantities = matchingEntries.map((point) => point.quantity);
    const minQuantity = Math.min(...quantities, 0);
    const maxQuantity = Math.max(...quantities, 0);
    const chartInnerWidth = this.chartWidth - this.chartPadding * 2;
    const chartInnerHeight = this.chartHeight - this.chartPadding * 2;

    return matchingEntries.map((point, index) => {
      const x = matchingEntries.length === 1
        ? this.chartWidth / 2
        : this.chartPadding + (index / (matchingEntries.length - 1)) * chartInnerWidth;
      const normalizedY = maxQuantity === minQuantity
        ? 0.5
        : (point.quantity - minQuantity) / (maxQuantity - minQuantity);
      const y = this.chartHeight - this.chartPadding - normalizedY * chartInnerHeight;

      return { ...point, x, y };
    });
  }

  get warehouseGraphPolylinePoints(): string {
    return this.warehouseGraphPoints.map((point) => `${point.x},${point.y}`).join(' ');
  }

  get warehouseGraphMinQuantity(): number {
    const quantities = this.warehouseGraphPoints.map((point) => point.quantity);
    return quantities.length ? Math.min(...quantities, 0) : 0;
  }

  get warehouseGraphMaxQuantity(): number {
    const quantities = this.warehouseGraphPoints.map((point) => point.quantity);
    return quantities.length ? Math.max(...quantities, 0) : 0;
  }

  formatMoney(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR'
    }).format(value);
  }

  private confirmCreateInvoice(): void {
    this.http.post(`${this.apiUrl}/invoices`, this.invoiceForm, this.httpOptions).subscribe({
      next: () => {
        this.closeCreateConfirm();
        this.invoiceForm = this.createEmptyInvoiceForm();
        this.loadData();
      },
      error: () => this.handleError('Could not create invoice.')
    });
  }

  private confirmCreatePayment(): void {
    this.http.post(`${this.apiUrl}/payments`, this.paymentForm, this.httpOptions).subscribe({
      next: () => {
        this.closeCreateConfirm();
        this.paymentForm = this.createEmptyAmountForm();
        this.loadData();
      },
      error: () => this.handleError('Could not create payment.')
    });
  }

  private loadData(): void {
    this.isLoading = true;
    this.errorMessage = '';

    forkJoin({
      suppliers: this.http.get<Supplier[]>(`${this.apiUrl}/suppliers`, this.httpOptions),
      invoices: this.http.get<Invoice[]>(`${this.apiUrl}/invoices`, this.httpOptions),
      payments: this.http.get<Payment[]>(`${this.apiUrl}/payments`, this.httpOptions),
      warehouse: this.http.get<Warehouse>(`${this.apiUrl}/warehouse`, this.httpOptions),
      employees: this.http.get<Employee[]>(`${this.apiUrl}/employees`, this.httpOptions),
      employeePayments: this.http.get<EmployeePayment[]>(`${this.apiUrl}/employee-payments`, this.httpOptions),
      dailyIncome: this.http.get<DailyIncome[]>(`${this.apiUrl}/daily-income`, this.httpOptions),
      expenses: this.http.get<Expense[]>(`${this.apiUrl}/expenses`, this.httpOptions)
    }).subscribe({
      next: ({ suppliers, invoices, payments, warehouse, employees, employeePayments, dailyIncome, expenses }) => {
        this.suppliers = suppliers;
        this.invoices = invoices;
        this.payments = payments;
        this.warehouse = warehouse;
        this.employees = employees;
        this.employeePayments = employeePayments;
        this.dailyIncome = dailyIncome;
        this.expenses = expenses;
        this.setDefaultSupplierSelections();
        this.isLoading = false;
        this.changeDetector.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) {
          this.clearAuthenticatedState();
          return;
        }

        this.handleError('Could not load data.');
      }
    });
  }

  private checkAuth(): void {
    this.http
      .get<{ authenticated: boolean }>(`${this.apiUrl}/auth/me`, this.httpOptions)
      .subscribe({
        next: ({ authenticated }) => {
          this.isAuthenticated = authenticated;
          this.isCheckingAuth = false;

          if (authenticated) {
            this.loadData();
          }

          this.changeDetector.detectChanges();
        },
        error: () => {
          this.isAuthenticated = false;
          this.isCheckingAuth = false;
          this.changeDetector.detectChanges();
        }
      });
  }

  private setDefaultSupplierSelections(): void {
    const firstSupplierId = this.suppliers[0]?.id ?? 0;

    if (!this.suppliers.some((supplier) => supplier.id === this.invoiceForm.supplierId)) {
      this.invoiceForm.supplierId = firstSupplierId;
    }

    if (!this.suppliers.some((supplier) => supplier.id === this.paymentForm.supplierId)) {
      this.paymentForm.supplierId = firstSupplierId;
    }

    if (!this.suppliers.some((supplier) => supplier.id === this.graphSupplierFilterId)) {
      this.graphSupplierFilterId = firstSupplierId;
    }

    const firstWarehouseItemId = this.warehouse.items[0]?.id ?? 0;

    if (!this.warehouse.items.some((item) => item.id === this.warehouseGraphItemId)) {
      this.warehouseGraphItemId = firstWarehouseItemId;
    }

    const firstEmployeeId = this.employees[0]?.id ?? 0;

    if (!this.employees.some((employee) => employee.id === this.employeePaymentForm.employeeId)) {
      this.employeePaymentForm.employeeId = firstEmployeeId;
    }
  }

  private createEmptySupplierForm(): SupplierForm {
    return {
      name: '',
      openAmount: 0,
      paidAmount: 0
    };
  }

  private createEmptyAmountForm(): AmountForm {
    return {
      supplierId: 0,
      date: '',
      amount: 0
    };
  }

  private createEmptyInvoiceForm(): InvoiceForm {
    return {
      ...this.createEmptyAmountForm(),
      invoiceNumber: ''
    };
  }

  private createEmptyWarehouse(): Warehouse {
    return {
      items: [],
      entries: []
    };
  }

  private createEmptyWarehouseEntryForm(): WarehouseEntryForm {
    return {
      type: 'add',
      date: '',
      items: [this.createEmptyWarehouseEntryItem()]
    };
  }

  private createEmptyWarehouseEntryItem(): WarehouseEntryItem {
    return {
      name: '',
      quantity: 0,
      useNewName: false
    };
  }

  private createEmptyEmployeeForm(): EmployeeForm {
    return {
      name: '',
      dayRate: 0,
      workedDays: 0
    };
  }

  private createEmptyEmployeePaymentForm(): EmployeePaymentForm {
    return {
      employeeId: 0,
      date: '',
      type: 'cash',
      amount: 0
    };
  }

  private createEmptyDailyIncomeForm(): DailyIncomeForm {
    return {
      date: '',
      cashAmount: 0,
      cardAmount: 0
    };
  }

  private createEmptyExpenseForm(): ExpenseForm {
    return {
      date: '',
      description: '',
      amount: 0
    };
  }

  private getDeleteEndpoint(type: DeleteType): string {
    if (type === 'employeePayment') {
      return 'employee-payments';
    }

    if (type === 'dailyIncome') {
      return 'daily-income';
    }

    return `${type}s`;
  }

  private sumEmployeePaymentsByType(type: EmployeePaymentType): number {
    return this.filteredEmployeePayments
      .filter((payment) => payment.type === type)
      .reduce((total, payment) => total + payment.amount, 0);
  }

  private clearAuthenticatedState(): void {
    this.isAuthenticated = false;
    this.isCheckingAuth = false;
    this.suppliers = [];
    this.invoices = [];
    this.payments = [];
    this.warehouse = this.createEmptyWarehouse();
    this.employees = [];
    this.employeePayments = [];
    this.dailyIncome = [];
    this.expenses = [];
    this.warehouseGraphItemId = 0;
    this.employeePaymentForm = this.createEmptyEmployeePaymentForm();
    this.errorMessage = '';
    this.changeDetector.detectChanges();
  }

  private handleError(message: string): void {
    this.errorMessage = message;
    this.isLoading = false;
    this.changeDetector.detectChanges();
  }
}
