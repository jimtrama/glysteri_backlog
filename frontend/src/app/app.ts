import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';

type Page = 'suppliers' | 'invoices' | 'payments' | 'graph' | 'warehouse';
type DeleteType = 'supplier' | 'invoice' | 'payment';
type CreateConfirmType = 'invoice' | 'payment';

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

  pages: Page[] = ['suppliers', 'invoices', 'payments', 'graph', 'warehouse'];
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
  newSupplier: SupplierForm = this.createEmptySupplierForm();
  supplierForm: SupplierForm = this.createEmptySupplierForm();
  invoiceForm: InvoiceForm = this.createEmptyInvoiceForm();
  paymentForm: AmountForm = this.createEmptyAmountForm();
  warehouseEntryForm: WarehouseEntryForm = this.createEmptyWarehouseEntryForm();
  supplierFilterId = 0;
  invoiceSupplierFilterId = 0;
  paymentSupplierFilterId = 0;
  graphSupplierFilterId = 0;
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
      warehouse: this.http.get<Warehouse>(`${this.apiUrl}/warehouse`, this.httpOptions)
    }).subscribe({
      next: ({ suppliers, invoices, payments, warehouse }) => {
        this.suppliers = suppliers;
        this.invoices = invoices;
        this.payments = payments;
        this.warehouse = warehouse;
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

  private getDeleteEndpoint(type: DeleteType): string {
    return `${type}s`;
  }

  private clearAuthenticatedState(): void {
    this.isAuthenticated = false;
    this.isCheckingAuth = false;
    this.suppliers = [];
    this.invoices = [];
    this.payments = [];
    this.warehouse = this.createEmptyWarehouse();
    this.errorMessage = '';
    this.changeDetector.detectChanges();
  }

  private handleError(message: string): void {
    this.errorMessage = message;
    this.isLoading = false;
    this.changeDetector.detectChanges();
  }
}
