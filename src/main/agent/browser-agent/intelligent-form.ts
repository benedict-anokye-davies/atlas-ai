/**
 * Intelligent Form Handler
 *
 * Advanced form understanding and filling with:
 * - Multi-page form handling (wizards, step forms)
 * - Field type inference and validation
 * - Auto-fill from user profiles
 * - CAPTCHA detection and handling
 * - File upload handling
 * - Dynamic form adaptation
 *
 * @module agent/browser-agent/intelligent-form
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { BrowserAction, IndexedElement, SemanticPurpose } from './types';
import type { Page, ElementHandle } from 'puppeteer-core';
import * as crypto from 'crypto';

const logger = createModuleLogger('IntelligentForm');

// ============================================================================
// Types
// ============================================================================

export interface FormAnalysis {
  /** Form ID */
  formId: string;
  /** Form name/title */
  name: string;
  /** Form type */
  type: FormType;
  /** All fields */
  fields: FormField[];
  /** Field groups */
  groups: FieldGroup[];
  /** Submit buttons */
  submitButtons: SubmitButton[];
  /** Is multi-page? */
  isMultiPage: boolean;
  /** Current step if multi-page */
  currentStep?: number;
  /** Total steps if multi-page */
  totalSteps?: number;
  /** Has CAPTCHA? */
  hasCaptcha: boolean;
  /** CAPTCHA type if present */
  captchaType?: CaptchaType;
  /** Required fields count */
  requiredFieldsCount: number;
  /** Filled fields count */
  filledFieldsCount: number;
  /** Validation errors */
  validationErrors: string[];
}

export type FormType =
  | 'login'
  | 'registration'
  | 'checkout'
  | 'contact'
  | 'search'
  | 'survey'
  | 'booking'
  | 'payment'
  | 'profile'
  | 'shipping'
  | 'unknown';

export interface FormField {
  /** Field ID */
  id: string;
  /** Element index */
  elementIndex: number;
  /** Field type */
  type: FieldType;
  /** Field name attribute */
  name: string;
  /** Label text */
  label: string;
  /** Placeholder */
  placeholder?: string;
  /** Is required? */
  required: boolean;
  /** Current value */
  currentValue: string;
  /** Validation pattern */
  validationPattern?: string;
  /** Auto-complete hint */
  autocomplete?: string;
  /** Options for select/radio */
  options?: FieldOption[];
  /** Min/max for numeric */
  min?: number;
  max?: number;
  /** Inferred purpose */
  inferredPurpose: FieldPurpose;
  /** Selector */
  selector: string;
  /** Group ID */
  groupId?: string;
  /** Has error? */
  hasError: boolean;
  /** Error message */
  errorMessage?: string;
}

export type FieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'tel'
  | 'number'
  | 'date'
  | 'datetime-local'
  | 'time'
  | 'url'
  | 'search'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'file'
  | 'hidden'
  | 'color'
  | 'range'
  | 'unknown';

export type FieldPurpose =
  | 'username'
  | 'email'
  | 'password'
  | 'password-confirm'
  | 'first-name'
  | 'last-name'
  | 'full-name'
  | 'phone'
  | 'address-line1'
  | 'address-line2'
  | 'city'
  | 'state'
  | 'postal-code'
  | 'country'
  | 'card-number'
  | 'card-expiry'
  | 'card-cvv'
  | 'card-holder'
  | 'date-of-birth'
  | 'company'
  | 'message'
  | 'search'
  | 'quantity'
  | 'terms-agreement'
  | 'newsletter'
  | 'unknown';

export interface FieldOption {
  value: string;
  text: string;
  selected: boolean;
}

export interface FieldGroup {
  id: string;
  name: string;
  fields: string[]; // Field IDs
  type: 'address' | 'payment' | 'personal' | 'contact' | 'shipping' | 'other';
}

export interface SubmitButton {
  elementIndex: number;
  text: string;
  type: 'submit' | 'button' | 'link';
  isPrimary: boolean;
  selector: string;
}

export type CaptchaType = 'recaptcha' | 'hcaptcha' | 'turnstile' | 'image' | 'text' | 'unknown';

export interface FormFillPlan {
  /** Fields to fill in order */
  fieldsToFill: FieldFillAction[];
  /** Submit action */
  submitAction?: BrowserAction;
  /** Estimated time to complete */
  estimatedTimeMs: number;
  /** Warnings */
  warnings: string[];
}

export interface FieldFillAction {
  fieldId: string;
  elementIndex: number;
  action: BrowserAction;
  value: string;
  waitAfterMs: number;
}

export interface UserProfile {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  company?: string;
  dateOfBirth?: string;
}

// ============================================================================
// Purpose Inference Patterns
// ============================================================================

const FIELD_PURPOSE_PATTERNS: Array<{
  purpose: FieldPurpose;
  patterns: RegExp[];
  autocomplete?: string[];
}> = [
  {
    purpose: 'email',
    patterns: [/email/i, /e-mail/i, /mail/i],
    autocomplete: ['email', 'username'],
  },
  {
    purpose: 'username',
    patterns: [/user\s*name/i, /login/i, /account/i, /nick/i],
    autocomplete: ['username'],
  },
  {
    purpose: 'password',
    patterns: [/^pass/i, /password/i, /pwd/i, /secret/i],
    autocomplete: ['current-password', 'new-password'],
  },
  {
    purpose: 'password-confirm',
    patterns: [/confirm.*pass/i, /repeat.*pass/i, /pass.*again/i, /re-?type/i],
  },
  {
    purpose: 'first-name',
    patterns: [/first\s*name/i, /given\s*name/i, /forename/i, /fname/i],
    autocomplete: ['given-name'],
  },
  {
    purpose: 'last-name',
    patterns: [/last\s*name/i, /sur\s*name/i, /family\s*name/i, /lname/i],
    autocomplete: ['family-name'],
  },
  {
    purpose: 'full-name',
    patterns: [/full\s*name/i, /^name$/i, /your\s*name/i],
    autocomplete: ['name'],
  },
  {
    purpose: 'phone',
    patterns: [/phone/i, /tel/i, /mobile/i, /cell/i],
    autocomplete: ['tel', 'tel-national'],
  },
  {
    purpose: 'address-line1',
    patterns: [/address\s*1/i, /street/i, /^address$/i],
    autocomplete: ['address-line1', 'street-address'],
  },
  {
    purpose: 'address-line2',
    patterns: [/address\s*2/i, /apt/i, /suite/i, /unit/i],
    autocomplete: ['address-line2'],
  },
  {
    purpose: 'city',
    patterns: [/city/i, /town/i, /locality/i],
    autocomplete: ['address-level2'],
  },
  {
    purpose: 'state',
    patterns: [/state/i, /province/i, /region/i, /county/i],
    autocomplete: ['address-level1'],
  },
  {
    purpose: 'postal-code',
    patterns: [/post\s*code/i, /zip/i, /postal/i],
    autocomplete: ['postal-code'],
  },
  {
    purpose: 'country',
    patterns: [/country/i, /nation/i],
    autocomplete: ['country', 'country-name'],
  },
  {
    purpose: 'card-number',
    patterns: [/card\s*number/i, /credit\s*card/i, /cc\s*num/i],
    autocomplete: ['cc-number'],
  },
  {
    purpose: 'card-expiry',
    patterns: [/expir/i, /exp\s*date/i, /valid/i],
    autocomplete: ['cc-exp'],
  },
  {
    purpose: 'card-cvv',
    patterns: [/cvv/i, /cvc/i, /security\s*code/i, /csv/i],
    autocomplete: ['cc-csc'],
  },
  {
    purpose: 'card-holder',
    patterns: [/card\s*holder/i, /name\s*on\s*card/i, /cardholder/i],
    autocomplete: ['cc-name'],
  },
  {
    purpose: 'date-of-birth',
    patterns: [/birth/i, /dob/i, /birthday/i],
    autocomplete: ['bday'],
  },
  {
    purpose: 'company',
    patterns: [/company/i, /organization/i, /business/i, /employer/i],
    autocomplete: ['organization'],
  },
  {
    purpose: 'message',
    patterns: [/message/i, /comment/i, /notes/i, /description/i],
  },
  {
    purpose: 'search',
    patterns: [/search/i, /query/i, /find/i],
  },
  {
    purpose: 'terms-agreement',
    patterns: [/terms/i, /agree/i, /accept/i, /privacy/i, /policy/i],
  },
  {
    purpose: 'newsletter',
    patterns: [/newsletter/i, /subscribe/i, /updates/i, /marketing/i],
  },
];

const FORM_TYPE_PATTERNS: Array<{ type: FormType; patterns: RegExp[] }> = [
  { type: 'login', patterns: [/login/i, /sign\s*in/i, /log\s*in/i] },
  { type: 'registration', patterns: [/register/i, /sign\s*up/i, /create\s*account/i, /join/i] },
  { type: 'checkout', patterns: [/checkout/i, /order/i, /purchase/i] },
  { type: 'contact', patterns: [/contact/i, /get\s*in\s*touch/i, /reach/i, /support/i] },
  { type: 'search', patterns: [/search/i, /find/i, /lookup/i] },
  { type: 'booking', patterns: [/book/i, /reserve/i, /appointment/i, /schedule/i] },
  { type: 'payment', patterns: [/payment/i, /pay/i, /billing/i] },
  { type: 'profile', patterns: [/profile/i, /account/i, /settings/i, /preferences/i] },
  { type: 'shipping', patterns: [/shipping/i, /delivery/i, /address/i] },
  { type: 'survey', patterns: [/survey/i, /feedback/i, /questionnaire/i] },
];

// ============================================================================
// Intelligent Form Handler
// ============================================================================

export class IntelligentFormHandler extends EventEmitter {
  private lastAnalysis: Map<string, FormAnalysis> = new Map();
  private userProfile: UserProfile = {};
  private customData: Map<string, string> = new Map();

  constructor() {
    super();
  }

  /**
   * Analyze all forms on the page
   */
  async analyzeForms(page: Page, elements: IndexedElement[]): Promise<FormAnalysis[]> {
    const forms: FormAnalysis[] = [];

    // Find form elements
    const formElements = await page.$$('form');

    for (let i = 0; i < formElements.length; i++) {
      const analysis = await this.analyzeForm(page, formElements[i], elements, `form-${i}`);
      forms.push(analysis);
    }

    // Also check for "implicit" forms (fields not in form tags)
    const orphanFields = elements.filter(e =>
      this.isFormField(e) && !e.attributes?.form
    );

    if (orphanFields.length > 0) {
      const implicitForm = this.createImplicitFormAnalysis(orphanFields, elements);
      forms.push(implicitForm);
    }

    return forms;
  }

  /**
   * Analyze a specific form
   */
  private async analyzeForm(
    page: Page,
    formHandle: ElementHandle,
    pageElements: IndexedElement[],
    formId: string
  ): Promise<FormAnalysis> {
    // Get form attributes
    const formData = await formHandle.evaluate(form => ({
      id: form.id || '',
      name: form.getAttribute('name') || '',
      action: form.action || '',
      method: form.method || 'get',
    }));

    // Find all input elements within this form
    const inputHandles = await formHandle.$$('input, textarea, select, button');
    const fields: FormField[] = [];
    const submitButtons: SubmitButton[] = [];

    for (const inputHandle of inputHandles) {
      const inputData = await inputHandle.evaluate(el => {
        const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const label = document.querySelector(`label[for="${input.id}"]`)?.textContent ||
          input.closest('label')?.textContent ||
          input.getAttribute('aria-label') || '';

        // Get options for select elements
        let options: Array<{ value: string; text: string; selected: boolean }> = [];
        if (input instanceof HTMLSelectElement) {
          options = Array.from(input.options).map(opt => ({
            value: opt.value,
            text: opt.text,
            selected: opt.selected,
          }));
        }

        return {
          tagName: el.tagName.toLowerCase(),
          type: (input as HTMLInputElement).type || el.tagName.toLowerCase(),
          id: input.id || '',
          name: input.name || '',
          value: (input as HTMLInputElement).value || '',
          placeholder: (input as HTMLInputElement).placeholder || '',
          required: input.required || input.getAttribute('aria-required') === 'true',
          label: label.trim().slice(0, 100),
          autocomplete: input.autocomplete || '',
          pattern: (input as HTMLInputElement).pattern || '',
          min: (input as HTMLInputElement).min || '',
          max: (input as HTMLInputElement).max || '',
          disabled: input.disabled,
          readonly: (input as HTMLInputElement).readOnly,
          className: input.className,
          options,
          selector: input.id ? `#${input.id}` : input.name ? `[name="${input.name}"]` : '',
          hasError: input.classList.contains('error') || 
                   input.getAttribute('aria-invalid') === 'true' ||
                   !!input.closest('.error, .has-error'),
          errorMessage: input.validationMessage || '',
        };
      });

      if (inputData.tagName === 'button' || inputData.type === 'submit') {
        const element = pageElements.find(e =>
          e.selector === inputData.selector || e.tagName === 'button'
        );
        submitButtons.push({
          elementIndex: element?.index || -1,
          text: inputData.value || inputData.label || 'Submit',
          type: inputData.type === 'submit' ? 'submit' : 'button',
          isPrimary: inputData.className.includes('primary') || inputData.type === 'submit',
          selector: inputData.selector,
        });
        continue;
      }

      if (inputData.type === 'hidden') continue;

      const element = pageElements.find(e =>
        e.selector === inputData.selector || e.attributes?.name === inputData.name
      );

      const field: FormField = {
        id: inputData.id || inputData.name || crypto.randomUUID().slice(0, 8),
        elementIndex: element?.index || -1,
        type: this.normalizeFieldType(inputData.type),
        name: inputData.name,
        label: inputData.label,
        placeholder: inputData.placeholder,
        required: inputData.required,
        currentValue: inputData.value,
        validationPattern: inputData.pattern,
        autocomplete: inputData.autocomplete,
        options: inputData.options.length > 0 ? inputData.options : undefined,
        min: inputData.min ? parseFloat(inputData.min) : undefined,
        max: inputData.max ? parseFloat(inputData.max) : undefined,
        inferredPurpose: this.inferFieldPurpose(inputData),
        selector: inputData.selector,
        hasError: inputData.hasError,
        errorMessage: inputData.errorMessage,
      };

      fields.push(field);
    }

    // Check for CAPTCHA
    const { hasCaptcha, captchaType } = await this.detectCaptcha(page);

    // Infer form type
    const formType = this.inferFormType(formData.action, fields);

    // Group fields
    const groups = this.groupFields(fields);

    // Check for multi-page form
    const { isMultiPage, currentStep, totalSteps } = await this.detectMultiPageForm(page);

    const analysis: FormAnalysis = {
      formId,
      name: formData.name || formType,
      type: formType,
      fields,
      groups,
      submitButtons,
      isMultiPage,
      currentStep,
      totalSteps,
      hasCaptcha,
      captchaType,
      requiredFieldsCount: fields.filter(f => f.required).length,
      filledFieldsCount: fields.filter(f => f.currentValue).length,
      validationErrors: fields.filter(f => f.hasError).map(f => f.errorMessage || `${f.label} has error`),
    };

    this.lastAnalysis.set(formId, analysis);
    return analysis;
  }

  /**
   * Create a fill plan for a form
   */
  async createFillPlan(
    analysis: FormAnalysis,
    data: Record<string, string>,
    userProfile?: UserProfile
  ): Promise<FormFillPlan> {
    const fieldsToFill: FieldFillAction[] = [];
    const warnings: string[] = [];
    const profile = userProfile || this.userProfile;

    for (const field of analysis.fields) {
      // Skip already filled
      if (field.currentValue && !data[field.name] && !data[field.id]) continue;

      // Get value from data, profile, or custom data
      let value = data[field.name] || data[field.id] || data[field.inferredPurpose];
      
      if (!value) {
        value = this.getValueFromProfile(field.inferredPurpose, profile);
      }

      if (!value) {
        value = this.customData.get(field.name) || this.customData.get(field.inferredPurpose) || '';
      }

      if (!value) {
        if (field.required) {
          warnings.push(`Required field "${field.label || field.name}" has no value`);
        }
        continue;
      }

      const action = this.createFieldAction(field, value);
      fieldsToFill.push({
        fieldId: field.id,
        elementIndex: field.elementIndex,
        action,
        value,
        waitAfterMs: this.estimateWaitTime(field),
      });
    }

    // Find submit button
    let submitAction: BrowserAction | undefined;
    const primarySubmit = analysis.submitButtons.find(b => b.isPrimary);
    if (primarySubmit) {
      submitAction = {
        type: 'click',
        elementIndex: primarySubmit.elementIndex,
        description: `Submit: ${primarySubmit.text}`,
      };
    }

    return {
      fieldsToFill,
      submitAction,
      estimatedTimeMs: fieldsToFill.reduce((sum, f) => sum + f.waitAfterMs + 200, 0),
      warnings,
    };
  }

  /**
   * Execute a fill plan
   */
  async executeFillPlan(page: Page, plan: FormFillPlan): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];

    for (const fieldAction of plan.fieldsToFill) {
      try {
        if (fieldAction.action.type === 'type') {
          await page.click(fieldAction.action.selector || `[data-index="${fieldAction.elementIndex}"]`);
          await page.keyboard.type(fieldAction.action.text || '', { delay: 50 });
        } else if (fieldAction.action.type === 'select') {
          await page.select(
            fieldAction.action.selector || `[data-index="${fieldAction.elementIndex}"]`,
            fieldAction.action.value || ''
          );
        } else if (fieldAction.action.type === 'click') {
          await page.click(fieldAction.action.selector || `[data-index="${fieldAction.elementIndex}"]`);
        }

        await this.waitMs(fieldAction.waitAfterMs);
      } catch (error) {
        errors.push(`Failed to fill ${fieldAction.fieldId}: ${error}`);
      }
    }

    return { success: errors.length === 0, errors };
  }

  /**
   * Set user profile for auto-fill
   */
  setUserProfile(profile: UserProfile): void {
    this.userProfile = profile;
  }

  /**
   * Set custom data for specific fields
   */
  setCustomData(key: string, value: string): void {
    this.customData.set(key, value);
  }

  /**
   * Get field purpose value from user profile
   */
  private getValueFromProfile(purpose: FieldPurpose, profile: UserProfile): string | undefined {
    switch (purpose) {
      case 'email': return profile.email;
      case 'first-name': return profile.firstName;
      case 'last-name': return profile.lastName;
      case 'full-name': return profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
      case 'phone': return profile.phone;
      case 'address-line1': return profile.address?.line1;
      case 'address-line2': return profile.address?.line2;
      case 'city': return profile.address?.city;
      case 'state': return profile.address?.state;
      case 'postal-code': return profile.address?.postalCode;
      case 'country': return profile.address?.country;
      case 'company': return profile.company;
      case 'date-of-birth': return profile.dateOfBirth;
      default: return undefined;
    }
  }

  /**
   * Create action for a field
   */
  private createFieldAction(field: FormField, value: string): BrowserAction {
    switch (field.type) {
      case 'select':
        return {
          type: 'select',
          elementIndex: field.elementIndex,
          value,
          description: `Select ${value} in ${field.label}`,
          selector: field.selector,
        };
      case 'checkbox':
      case 'radio':
        return {
          type: 'click',
          elementIndex: field.elementIndex,
          description: `Click ${field.label}`,
          selector: field.selector,
        };
      default:
        return {
          type: 'type',
          elementIndex: field.elementIndex,
          text: value,
          description: `Type ${value.slice(0, 20)}... in ${field.label}`,
          selector: field.selector,
        };
    }
  }

  /**
   * Normalize field type
   */
  private normalizeFieldType(type: string): FieldType {
    const typeMap: Record<string, FieldType> = {
      text: 'text',
      email: 'email',
      password: 'password',
      tel: 'tel',
      number: 'number',
      date: 'date',
      'datetime-local': 'datetime-local',
      time: 'time',
      url: 'url',
      search: 'search',
      textarea: 'textarea',
      select: 'select',
      'select-one': 'select',
      'select-multiple': 'select',
      checkbox: 'checkbox',
      radio: 'radio',
      file: 'file',
      hidden: 'hidden',
      color: 'color',
      range: 'range',
    };
    return typeMap[type.toLowerCase()] || 'unknown';
  }

  /**
   * Infer field purpose from attributes
   */
  private inferFieldPurpose(data: {
    name: string;
    label: string;
    placeholder: string;
    autocomplete: string;
    type: string;
  }): FieldPurpose {
    // Check autocomplete first (most reliable)
    for (const pattern of FIELD_PURPOSE_PATTERNS) {
      if (pattern.autocomplete?.includes(data.autocomplete)) {
        return pattern.purpose;
      }
    }

    // Check patterns against name, label, placeholder
    const textToCheck = `${data.name} ${data.label} ${data.placeholder}`;

    for (const pattern of FIELD_PURPOSE_PATTERNS) {
      for (const regex of pattern.patterns) {
        if (regex.test(textToCheck)) {
          return pattern.purpose;
        }
      }
    }

    // Fallback based on type
    if (data.type === 'email') return 'email';
    if (data.type === 'password') return 'password';
    if (data.type === 'tel') return 'phone';
    if (data.type === 'search') return 'search';

    return 'unknown';
  }

  /**
   * Infer form type
   */
  private inferFormType(action: string, fields: FormField[]): FormType {
    // Check action URL
    const actionLower = action.toLowerCase();
    for (const pattern of FORM_TYPE_PATTERNS) {
      for (const regex of pattern.patterns) {
        if (regex.test(actionLower)) {
          return pattern.type;
        }
      }
    }

    // Infer from fields
    const purposes = fields.map(f => f.inferredPurpose);

    if (purposes.includes('password') && purposes.includes('email') || purposes.includes('username')) {
      if (purposes.includes('password-confirm') || fields.length > 3) {
        return 'registration';
      }
      return 'login';
    }

    if (purposes.includes('card-number') || purposes.includes('card-cvv')) {
      return 'payment';
    }

    if (purposes.includes('address-line1') && purposes.includes('postal-code')) {
      return 'shipping';
    }

    if (purposes.includes('message') && purposes.includes('email')) {
      return 'contact';
    }

    if (purposes.includes('search')) {
      return 'search';
    }

    return 'unknown';
  }

  /**
   * Group related fields
   */
  private groupFields(fields: FormField[]): FieldGroup[] {
    const groups: FieldGroup[] = [];

    // Address group
    const addressFields = fields.filter(f =>
      ['address-line1', 'address-line2', 'city', 'state', 'postal-code', 'country'].includes(f.inferredPurpose)
    );
    if (addressFields.length >= 2) {
      groups.push({
        id: 'address',
        name: 'Address',
        fields: addressFields.map(f => f.id),
        type: 'address',
      });
    }

    // Payment group
    const paymentFields = fields.filter(f =>
      ['card-number', 'card-expiry', 'card-cvv', 'card-holder'].includes(f.inferredPurpose)
    );
    if (paymentFields.length >= 2) {
      groups.push({
        id: 'payment',
        name: 'Payment',
        fields: paymentFields.map(f => f.id),
        type: 'payment',
      });
    }

    // Personal group
    const personalFields = fields.filter(f =>
      ['first-name', 'last-name', 'full-name', 'date-of-birth'].includes(f.inferredPurpose)
    );
    if (personalFields.length >= 2) {
      groups.push({
        id: 'personal',
        name: 'Personal Information',
        fields: personalFields.map(f => f.id),
        type: 'personal',
      });
    }

    return groups;
  }

  /**
   * Detect CAPTCHA on page
   */
  private async detectCaptcha(page: Page): Promise<{ hasCaptcha: boolean; captchaType?: CaptchaType }> {
    const result = await page.evaluate(() => {
      // reCAPTCHA
      if (document.querySelector('.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]')) {
        return { hasCaptcha: true, captchaType: 'recaptcha' };
      }

      // hCaptcha
      if (document.querySelector('.h-captcha, iframe[src*="hcaptcha"]')) {
        return { hasCaptcha: true, captchaType: 'hcaptcha' };
      }

      // Cloudflare Turnstile
      if (document.querySelector('.cf-turnstile, iframe[src*="turnstile"]')) {
        return { hasCaptcha: true, captchaType: 'turnstile' };
      }

      // Image CAPTCHA
      if (document.querySelector('[class*="captcha"] img, img[alt*="captcha"]')) {
        return { hasCaptcha: true, captchaType: 'image' };
      }

      return { hasCaptcha: false };
    });

    return result as { hasCaptcha: boolean; captchaType?: CaptchaType };
  }

  /**
   * Detect multi-page form
   */
  private async detectMultiPageForm(page: Page): Promise<{
    isMultiPage: boolean;
    currentStep?: number;
    totalSteps?: number;
  }> {
    const result = await page.evaluate(() => {
      // Look for step indicators
      const stepIndicators = document.querySelectorAll(
        '[class*="step"], [class*="progress"], [data-step], [aria-current="step"]'
      );

      if (stepIndicators.length > 0) {
        const current = document.querySelector('[aria-current="step"], .active, .current');
        const allSteps = document.querySelectorAll('.step, [data-step]');

        if (allSteps.length > 1) {
          const currentIndex = current ? Array.from(allSteps).indexOf(current as Element) + 1 : 1;
          return {
            isMultiPage: true,
            currentStep: currentIndex,
            totalSteps: allSteps.length,
          };
        }
      }

      // Look for "next" button without "submit"
      const nextButton = document.querySelector('button:contains("Next"), [value*="Next"]');
      if (nextButton && !document.querySelector('[type="submit"]')) {
        return { isMultiPage: true };
      }

      return { isMultiPage: false };
    });

    return result;
  }

  /**
   * Check if element is a form field
   */
  private isFormField(element: IndexedElement): boolean {
    return ['input', 'textarea', 'select'].includes(element.tagName);
  }

  /**
   * Create implicit form analysis for orphan fields
   */
  private createImplicitFormAnalysis(
    orphanFields: IndexedElement[],
    allElements: IndexedElement[]
  ): FormAnalysis {
    const fields = orphanFields.map(el => ({
      id: el.attributes?.id || el.attributes?.name || crypto.randomUUID().slice(0, 8),
      elementIndex: el.index,
      type: this.normalizeFieldType(el.attributes?.type || el.tagName),
      name: el.attributes?.name || '',
      label: el.ariaLabel || '',
      required: el.attributes?.required === 'true',
      currentValue: el.attributes?.value || '',
      inferredPurpose: 'unknown' as FieldPurpose,
      selector: el.selector || '',
      hasError: false,
    }));

    return {
      formId: 'implicit-form',
      name: 'Implicit Form',
      type: 'unknown',
      fields: fields as FormField[],
      groups: [],
      submitButtons: [],
      isMultiPage: false,
      hasCaptcha: false,
      requiredFieldsCount: fields.filter(f => f.required).length,
      filledFieldsCount: fields.filter(f => f.currentValue).length,
      validationErrors: [],
    };
  }

  /**
   * Estimate wait time after field interaction
   */
  private estimateWaitTime(field: FormField): number {
    // Longer wait for fields that might trigger async validation
    if (field.type === 'email' || field.inferredPurpose === 'username') {
      return 500;
    }
    // Short wait for most fields
    return 100;
  }

  private waitMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let formHandlerInstance: IntelligentFormHandler | null = null;

export function getIntelligentFormHandler(): IntelligentFormHandler {
  if (!formHandlerInstance) {
    formHandlerInstance = new IntelligentFormHandler();
  }
  return formHandlerInstance;
}

export function createIntelligentFormHandler(): IntelligentFormHandler {
  return new IntelligentFormHandler();
}
