import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';

type Page = 'suppliers' | 'invoices' | 'payments';
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

interface DeleteTarget {
  type: DeleteType;
  id: number;
  label: string;
}

interface ConfirmRow {
  label: string;
  value: string;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private readonly apiUrl = 'http://127.0.0.1:8084/api';

  pages: Page[] = ['suppliers', 'invoices', 'payments'];
  currentPage: Page = 'suppliers';
  suppliers: Supplier[] = [];
  invoices: Invoice[] = [];
  payments: Payment[] = [];
  newSupplier: SupplierForm = this.createEmptySupplierForm();
  supplierForm: SupplierForm = this.createEmptySupplierForm();
  invoiceForm: InvoiceForm = this.createEmptyInvoiceForm();
  paymentForm: AmountForm = this.createEmptyAmountForm();
  supplierFilterId = 0;
  invoiceSupplierFilterId = 0;
  paymentSupplierFilterId = 0;
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
    this.loadData();
  }

  navigate(page: Page): void {
    this.currentPage = page;
    this.errorMessage = '';
  }

  createSupplier(): void {
    this.http.post<Supplier>(`${this.apiUrl}/suppliers`, this.newSupplier).subscribe({
      next: () => {
        this.newSupplier = this.createEmptySupplierForm();
        this.loadData();
      },
      error: () => this.handleError('Could not create supplier.')
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
      .put<Supplier>(`${this.apiUrl}/suppliers/${this.editingSupplier.id}`, this.supplierForm)
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

    this.http.delete<void>(endpoint).subscribe({
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

  formatMoney(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR'
    }).format(value);
  }

  private confirmCreateInvoice(): void {
    this.http.post(`${this.apiUrl}/invoices`, this.invoiceForm).subscribe({
      next: () => {
        this.closeCreateConfirm();
        this.invoiceForm = this.createEmptyInvoiceForm();
        this.loadData();
      },
      error: () => this.handleError('Could not create invoice.')
    });
  }

  private confirmCreatePayment(): void {
    this.http.post(`${this.apiUrl}/payments`, this.paymentForm).subscribe({
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
      suppliers: this.http.get<Supplier[]>(`${this.apiUrl}/suppliers`),
      invoices: this.http.get<Invoice[]>(`${this.apiUrl}/invoices`),
      payments: this.http.get<Payment[]>(`${this.apiUrl}/payments`)
    }).subscribe({
      next: ({ suppliers, invoices, payments }) => {
        this.suppliers = suppliers;
        this.invoices = invoices;
        this.payments = payments;
        this.setDefaultSupplierSelections();
        this.isLoading = false;
        this.changeDetector.detectChanges();
      },
      error: () => this.handleError('Could not load data.')
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

  private getDeleteEndpoint(type: DeleteType): string {
    return `${type}s`;
  }

  private handleError(message: string): void {
    this.errorMessage = message;
    this.isLoading = false;
    this.changeDetector.detectChanges();
  }
}
