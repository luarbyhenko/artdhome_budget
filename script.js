/**
 * =========================================================
 * ART'DHOME ERP - FRONTEND LOGIC
 * ---------------------------------------------------------
 * Frontend principal para:
 * - Gestión visual de specialties y line items
 * - Cálculo de subtotales y resumen global
 * - Lectura / edición de budgets guardados
 * - Integración con Google Apps Script
 *
 * Este archivo fue ajustado para trabajar con la estructura
 * HTML actual del sistema:
 * - specialty-total-display
 * - specialty-amount-input
 * - line-item-amount-input
 * - line-items-container
 *
 * Reglas funcionales:
 * - Una specialty puede trabajar en modo "direct amount"
 *   o en modo "line items", pero no en ambos al mismo tiempo.
 * =========================================================
 */

const BACKEND_URL = "https://script.google.com/macros/s/AKfycbzJ8XdT-6LayWaK-abUwjwmnix3AZA6p_s_ibvHIRK8bMsE1V6M77i45ackftl3l4kl/exec";

let budgetsCache = [];
let isReadOnlyMode = false;
let currentEditingInternalId = null;

document.addEventListener("DOMContentLoaded", function () {
    const addButton = document.getElementById("add-specialty-btn");
    const container = document.getElementById("specialties-container");
    const template = document.getElementById("specialty-template");
    const viewBudgetsButton = document.getElementById("view-budgets-btn");
    const closeBudgetsDrawerButton = document.getElementById("close-budgets-drawer-btn");
    const budgetsDrawerOverlay = document.getElementById("budgets-drawer-overlay");
    const saveBudgetButton = document.getElementById("save-budget-btn");
    const managementFeeInput = document.getElementById("management-fee-input");
    const totalAreaInput = document.getElementById("total-area-input");
    const budgetsDrawerList = document.getElementById("budgets-drawer-list");
    const closeReadonlyButton = document.getElementById("close-readonly-btn");

    /**
     * =========================================================
     * VALIDACIÓN BÁSICA DEL DOM
     * =========================================================
     */
    if (!addButton || !container || !template) {
        console.error("No se encontraron elementos clave del sistema.");
        return;
    }

    /**
     * =========================================================
     * EVENTOS UI GENERALES
     * =========================================================
     */
    if (viewBudgetsButton) {
        viewBudgetsButton.addEventListener("click", openBudgetsDrawer);
    }

    if (closeBudgetsDrawerButton) {
        closeBudgetsDrawerButton.addEventListener("click", closeBudgetsDrawer);
    }

    if (budgetsDrawerOverlay) {
        budgetsDrawerOverlay.addEventListener("click", closeBudgetsDrawer);
    }

    if (saveBudgetButton) {
        saveBudgetButton.addEventListener("click", guardarBudget);
    }

    if (closeReadonlyButton) {
        closeReadonlyButton.addEventListener("click", cerrarModoLecturaYVolverAPresupuestos);
    }

    if (managementFeeInput) {
        managementFeeInput.addEventListener("input", updateGlobalSummary);
    }

    if (totalAreaInput) {
        totalAreaInput.addEventListener("input", updateGlobalSummary);
    }

    /**
     * =========================================================
     * DRAWER DE BUDGETS GUARDADOS
     * =========================================================
     */
    if (budgetsDrawerList) {
        budgetsDrawerList.addEventListener("click", function (event) {
            const viewButton = event.target.closest(".view-budget-btn");
            if (viewButton) {
                const internalId = viewButton.dataset.internalId;
                abrirBudgetEnModoLectura(internalId);
                return;
            }

            const editButton = event.target.closest(".edit-budget-btn");
            if (editButton) {
                const internalId = editButton.dataset.internalId;
                abrirBudgetParaEdicion(internalId);
            }
        });
    }

    /**
     * =========================================================
     * CARGA INICIAL
     * =========================================================
     */
    actualizarFechaActual();
    obtenerIdOficial();
    inicializarSubtotales();
    updateGlobalSummary();

    /**
     * =========================================================
     * BOTÓN: ADD SPECIALTY
     * =========================================================
     */
    addButton.addEventListener("click", function () {
    if (isReadOnlyMode) return;

    const clone = template.content.cloneNode(true);
    container.prepend(clone);

    const newCard = container.firstElementChild;
    if (!newCard) return;

    const specialtyNameInput = newCard.querySelector(".specialty-name-input");
    if (specialtyNameInput) {
        specialtyNameInput.focus();
        specialtyNameInput.select();
    }

    calculateSpecialtySubtotal(newCard);
    updateAddLineButtonState(newCard);
});

    /**
     * =========================================================
     * EVENTO DELEGADO: CLICK EN SPECIALTIES / LINE ITEMS
     * =========================================================
     */
    container.addEventListener("click", function (event) {
        if (isReadOnlyMode) return;

        /**
         * ---------------------------------------------------------
         * TOGGLE SPECIALTY
         * ---------------------------------------------------------
         */
        const toggleButton = event.target.closest(".specialty-toggle-btn");
        if (toggleButton) {
            const specialtyCard = toggleButton.closest(".specialty-card");
            if (!specialtyCard) return;

            const specialtyBody = specialtyCard.querySelector(".specialty-body");
            const nameInput = specialtyCard.querySelector(".specialty-name-input");
            const icon = toggleButton.querySelector(".material-symbols-outlined");

            if (!specialtyBody) return;

            const isCollapsed = specialtyCard.classList.contains("is-collapsed");

            if (isCollapsed) {
                specialtyCard.classList.remove("is-collapsed");
                specialtyBody.classList.remove("hidden");

                if (icon) icon.textContent = "expand_less";

                if (nameInput) {
                    nameInput.removeAttribute("readonly");
                }
            } else {
                specialtyBody.classList.add("hidden");
                specialtyCard.classList.add("is-collapsed");

                if (icon) icon.textContent = "expand_more";

                if (nameInput) {
                    nameInput.setAttribute("readonly", "true");
                }
            }

            return;
        }

        /**
         * ---------------------------------------------------------
         * DELETE SPECIALTY
         * ---------------------------------------------------------
         */
        const deleteButton = event.target.closest(".delete-specialty-btn");
        if (deleteButton) {
            const specialtyCard = deleteButton.closest(".specialty-card");
            if (specialtyCard) {
                specialtyCard.remove();
                updateGlobalSummary();
            }
            return;
        }

        /**
         * ---------------------------------------------------------
         * SAVE SPECIALTY
         * ---------------------------------------------------------
         * Valida que:
         * - tenga nombre
         * - tenga amount directo o al menos una línea
         */
        const saveSpecialtyButton = event.target.closest(".save-specialty-btn");
        if (saveSpecialtyButton) {
            const specialtyCard = saveSpecialtyButton.closest(".specialty-card");
            if (!specialtyCard) return;

            const nameInput = specialtyCard.querySelector(".specialty-name-input");
            const specialtyBody = specialtyCard.querySelector(".specialty-body");
            const specialtyAmountInput = specialtyCard.querySelector(".specialty-amount-input");
            const lineItemsContainer = specialtyCard.querySelector(".line-items-container");
            const toggleButtonInCard = specialtyCard.querySelector(".specialty-toggle-btn");
            const icon = toggleButtonInCard
                ? toggleButtonInCard.querySelector(".material-symbols-outlined")
                : null;

            if (!nameInput || !specialtyBody) return;

            const specialtyName = nameInput.value.trim();
            const directAmount = Number(specialtyAmountInput?.value || 0);
            const lineItemsCount = lineItemsContainer ? lineItemsContainer.children.length : 0;

            if (!specialtyName) {
                alert("Please enter a specialty name.");
                nameInput.focus();
                return;
            }

            if (directAmount <= 0 && lineItemsCount === 0) {
                alert("Please enter a direct amount or add at least one line item.");
                return;
            }

            specialtyBody.classList.add("hidden");
            specialtyCard.classList.add("is-collapsed");
            nameInput.setAttribute("readonly", "true");

            if (icon) {
                icon.textContent = "expand_more";
            }

            return;
        }

        /**
         * ---------------------------------------------------------
         * ADD LINE ITEM
         * ---------------------------------------------------------
         * Si existe monto directo, no se pueden agregar líneas.
         * Si se agregan líneas, el amount directo se desactiva.
         */
        const addLineBtn = event.target.closest(".add-line-item-btn");
        if (addLineBtn) {
            const specialtyCard = addLineBtn.closest(".specialty-card");
            if (!specialtyCard) return;

            const amountInput = specialtyCard.querySelector(".specialty-amount-input");
            const lineItemsContainer = specialtyCard.querySelector(".line-items-container");
            const lineItemTemplate = document.getElementById("line-item-template");

            if (!lineItemsContainer || !lineItemTemplate) return;

            const amountValue = Number(amountInput?.value || 0);

            // Si ya existe un monto directo, no permitimos agregar líneas
            if (amountValue > 0) {
                return;
            }

            // Al trabajar con líneas, el monto directo queda deshabilitado
            if (amountInput) {
                amountInput.value = "";
                amountInput.disabled = true;
                amountInput.classList.add("opacity-40", "pointer-events-none");
            }

            const clone = lineItemTemplate.content.cloneNode(true);
lineItemsContainer.prepend(clone);

const newLineItem = lineItemsContainer.firstElementChild;
if (newLineItem) {
    updateLineItemHeaderAmount?.(newLineItem);
}

calculateSpecialtySubtotal(specialtyCard);
updateGlobalSummary();
            return;
        }

        // TOGGLE LINE ITEM
const lineItemToggleBtn = event.target.closest(".line-item-toggle-btn");

if (lineItemToggleBtn) {
    const lineItemRow = lineItemToggleBtn.closest(".line-item-row");
    if (!lineItemRow) return;

    const lineItemBody = lineItemRow.querySelector(".line-item-body");
    const descriptionInput = lineItemRow.querySelector(".line-item-description-input");
    const icon = lineItemToggleBtn.querySelector(".material-symbols-outlined");

    if (!lineItemBody) return;

    const isCollapsed = lineItemRow.classList.contains("is-collapsed");

    if (isCollapsed) {
        lineItemRow.classList.remove("is-collapsed");
        lineItemBody.classList.remove("hidden");

        if (icon) icon.textContent = "expand_less";

        if (descriptionInput) {
            descriptionInput.removeAttribute("readonly");
        }
    } else {
        lineItemBody.classList.add("hidden");
        lineItemRow.classList.add("is-collapsed");

        if (icon) icon.textContent = "expand_more";

        if (descriptionInput) {
            descriptionInput.setAttribute("readonly", "true");
        }
    }

    return;
}


        // SAVE LINE ITEM
const saveLineBtn = event.target.closest(".save-line-item-btn");
if (saveLineBtn) {
    const lineItemRow = saveLineBtn.closest(".line-item-row");
    if (!lineItemRow) return;

    const lineItemBody = lineItemRow.querySelector(".line-item-body");
    const descriptionInput = lineItemRow.querySelector(".line-item-description-input");
    const toggleButton = lineItemRow.querySelector(".line-item-toggle-btn");
    const icon = toggleButton ? toggleButton.querySelector(".material-symbols-outlined") : null;

    if (!lineItemBody) return;

    const description = descriptionInput?.value.trim() || "";
const amountInput = lineItemRow.querySelector(".line-item-amount-input");
const amountValue = Number(amountInput?.value || 0);

if (!description) {
    alert("Please enter a line item description.");
    descriptionInput?.focus();
    return;
}

if (amountValue <= 0) {
    alert("Please enter an amount for this line item.");
    amountInput?.focus();
    return;
}

    lineItemBody.classList.add("hidden");
    lineItemRow.classList.add("is-collapsed");

    if (icon) {
        icon.textContent = "expand_more";
    }

    if (descriptionInput) {
        descriptionInput.setAttribute("readonly", "true");
    }

    return;
}

        /**
         * ---------------------------------------------------------
         * DELETE LINE ITEM
         * ---------------------------------------------------------
         * Si se eliminan todas las líneas, se reactiva el amount.
         */
        const deleteLineBtn = event.target.closest(".delete-line-item-btn");
        if (deleteLineBtn) {
            const lineRow = deleteLineBtn.closest(".line-item-row");
            if (lineRow) {
                const specialtyCard = lineRow.closest(".specialty-card");
                const lineItemsContainer = specialtyCard?.querySelector(".line-items-container");
                const amountInput = specialtyCard?.querySelector(".specialty-amount-input");

                lineRow.remove();

                if (lineItemsContainer && amountInput && lineItemsContainer.children.length === 0) {
                    amountInput.disabled = false;
                    amountInput.classList.remove("opacity-40", "pointer-events-none");
                }

                calculateSpecialtySubtotal(specialtyCard);
                updateGlobalSummary();
            }
            return;
        }
    });

    /**
     * =========================================================
     * EVENTO DELEGADO: INPUT EN SPECIALTIES / LINE ITEMS
     * =========================================================
     */
    container.addEventListener("input", function (event) {
        if (isReadOnlyMode) return;

        const specialtyCard = event.target.closest(".specialty-card");

        /**
         * ---------------------------------------------------------
         * Si se edita el amount directo de specialty:
         * - recalcula subtotal
         * - deshabilita Add Line
         * - limpia líneas existentes si hay valor > 0
         * ---------------------------------------------------------
         */
        if (event.target.matches(".specialty-amount-input")) {
            if (specialtyCard) {
                calculateSpecialtySubtotal(specialtyCard);
            }
            return;
        }

        /**
         * ---------------------------------------------------------
         * Si se edita cualquier amount de línea:
         * - recalcula subtotal
         * ---------------------------------------------------------
         */
        if (event.target.matches(".line-item-amount-input")) {
    const lineItemRow = event.target.closest(".line-item-row");

    if (lineItemRow) {
        updateLineItemHeaderAmount(lineItemRow);
    }

    if (specialtyCard) {
        calculateSpecialtySubtotal(specialtyCard);
    }
    return;
}

        /**
         * ---------------------------------------------------------
         * Si se edita texto dentro de specialty o línea:
         * - actualiza resumen global
         * ---------------------------------------------------------
         */
        if (event.target.matches(".specialty-name-input, .line-item-description-input, .line-item-unit-input")) {
            updateGlobalSummary();
        }
    });
});

/**
 * =========================================================
 * OBTENER BUDGET ID OFICIAL
 * =========================================================
 */
async function obtenerIdOficial() {
    try {
        const response = await fetch(`${BACKEND_URL}?action=generateId`);
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || "No se pudo obtener el Budget ID");
        }

        const budgetIdDisplay = document.getElementById("budget-id-display");
        if (budgetIdDisplay) {
            budgetIdDisplay.textContent = `Budget ID: ${data.nuevoId}`;
        }
    } catch (error) {
        console.error("Error al obtener Budget ID:", error);

        const budgetIdDisplay = document.getElementById("budget-id-display");
        if (budgetIdDisplay) {
            budgetIdDisplay.textContent = "Budget ID: Error";
        }
    }
}

/**
 * =========================================================
 * DRAWER
 * =========================================================
 */
function openBudgetsDrawer() {
    const overlay = document.getElementById("budgets-drawer-overlay");
    const drawer = document.getElementById("budgets-drawer");

    if (!overlay || !drawer) return;

    overlay.classList.remove("hidden");
    requestAnimationFrame(() => {
        overlay.classList.remove("opacity-0");
        drawer.classList.remove("translate-x-full");
    });

    fetchBudgetsList();
}

function closeBudgetsDrawer() {
    const overlay = document.getElementById("budgets-drawer-overlay");
    const drawer = document.getElementById("budgets-drawer");

    if (!overlay || !drawer) return;

    overlay.classList.add("opacity-0");
    drawer.classList.add("translate-x-full");

    setTimeout(() => {
        overlay.classList.add("hidden");
    }, 300);
}

/**
 * =========================================================
 * CARGA DE BUDGETS GUARDADOS
 * =========================================================
 */
async function fetchBudgetsList() {
    const listContainer = document.getElementById("budgets-drawer-list");
    if (!listContainer) return;

    listContainer.innerHTML = `
        <div class="rounded-xl border border-outline/20 bg-surface-container p-5">
            <p class="text-on-surface font-bold text-[10px] uppercase tracking-widest mb-2">
                Loading budgets...
            </p>
            <p class="text-on-surface-variant text-xs leading-relaxed">
                Please wait while we load your saved budgets.
            </p>
        </div>
    `;

    try {
        const response = await fetch(`${BACKEND_URL}?action=listBudgets`);
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || "Could not load budgets.");
        }

        budgetsCache = data.budgets || [];
        renderBudgetsList(budgetsCache);
    } catch (error) {
        console.error("Error loading budgets:", error);

        listContainer.innerHTML = `
            <div class="rounded-xl border border-error/20 bg-surface-container p-5">
                <p class="text-error font-bold text-[10px] uppercase tracking-widest mb-2">
                    Error loading budgets
                </p>
                <p class="text-on-surface-variant text-xs leading-relaxed">
                    ${escapeHtml(error.message || "Unknown error")}
                </p>
            </div>
        `;
    }
}

function renderBudgetsList(items) {
    const listContainer = document.getElementById("budgets-drawer-list");
    if (!listContainer) return;

    listContainer.innerHTML = "";

    if (!items.length) {
        listContainer.innerHTML = `
            <div class="rounded-xl border border-dashed border-outline/30 bg-surface-container p-5 text-center">
                <p class="text-on-surface font-bold text-[10px] uppercase tracking-widest mb-2">
                    No saved budgets
                </p>
                <p class="text-on-surface-variant text-xs leading-relaxed">
                    Your saved budgets will appear here once you create them.
                </p>
            </div>
        `;
        return;
    }

    items.forEach(item => {
        const card = document.createElement("div");
        card.className = "rounded-xl border border-outline/20 bg-surface-container p-4 sm:p-5 space-y-4";

        const totalValue = Number(item.total || 0);
        const totalAreaValue = Number(item.totalArea || 0);

        const formattedTotal = totalValue.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        const formattedCostPerSf = totalAreaValue > 0
            ? (totalValue / totalAreaValue).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })
            : "--";

        const formattedDate = formatBudgetDate(item.createdAt);

        card.innerHTML = `
            <div class="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 items-start">
                <div class="min-w-0">
                    <p class="text-on-surface-variant text-[9px] uppercase tracking-widest font-bold mb-1">
                        Project
                    </p>
                    <p class="text-on-surface font-bold text-sm uppercase tracking-wide truncate">
                        ${escapeHtml(item.projectName || "Untitled Project")}
                    </p>
                </div>

                <div class="min-w-0 text-left sm:text-center">
                    <p class="text-on-surface-variant text-[9px] uppercase tracking-widest font-bold mb-1">
                        Total Budget
                    </p>
                    <p class="text-primary font-black text-sm tracking-tight">
                        $${formattedTotal}
                    </p>
                </div>

                <div class="min-w-0 text-left sm:text-right">
                    <p class="text-on-surface-variant text-[9px] uppercase tracking-widest font-bold mb-1">
                        Cost / SF
                    </p>
                    <p class="text-on-surface font-bold text-sm tracking-tight">
                        ${formattedCostPerSf === "--" ? "--" : `$${formattedCostPerSf}`}
                    </p>
                </div>
            </div>

            <div class="flex items-center justify-between gap-4 pt-3 border-t border-outline/20">
                <p class="text-on-surface-variant text-[10px] uppercase tracking-widest">
                    ${escapeHtml(formattedDate)}
                </p>

                <div class="flex items-center gap-2 shrink-0">
                    <button
                        type="button"
                        class="view-budget-btn p-2 rounded-lg border border-outline/20 text-on-surface-variant hover:bg-white/5 hover:text-on-surface transition-colors"
                        data-internal-id="${escapeHtml(item.internalId)}"
                        aria-label="View budget"
                        title="View budget"
                    >
                        <span class="material-symbols-outlined text-[18px]">visibility</span>
                    </button>

                    <button
                        type="button"
                        class="edit-budget-btn bg-primary text-on-primary font-label font-bold uppercase tracking-widest text-[10px] px-4 py-2 rounded-lg shadow-lg shadow-primary/20 hover:brightness-110 transition-all active:scale-95"
                        data-internal-id="${escapeHtml(item.internalId)}"
                    >
                        Edit
                    </button>
                </div>
            </div>
        `;

        listContainer.appendChild(card);
    });
}

/**
 * =========================================================
 * FECHA ACTUAL
 * =========================================================
 */
function actualizarFechaActual() {
    const dateElement = document.getElementById("current-date-display");
    if (!dateElement) return;

    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();

    dateElement.textContent = `Date: ${day}/${month}/${year}`;
}

/**
 * =========================================================
 * CALCULAR SUBTOTAL DE SPECIALTY
 * ---------------------------------------------------------
 * Reglas:
 * - Si existe monto directo > 0, ese es el subtotal
 * - Si no, suma solo los amounts de las líneas
 * =========================================================
 */
function calculateSpecialtySubtotal(card) {
    if (!card) return;

    const specialtyAmountInput = card.querySelector(".specialty-amount-input");
    const subtotalElement = card.querySelector(".specialty-total-display");
    const lineAmountInputs = card.querySelectorAll(".line-item-amount-input");

    let total = 0;
    const directAmount = Number(specialtyAmountInput?.value || 0);

    if (directAmount > 0) {
        total = directAmount;
    } else {
        lineAmountInputs.forEach(input => {
            total += Number(input.value || 0);
        });
    }

    if (subtotalElement) {
        subtotalElement.textContent = `$${total.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    }

    updateAddLineButtonState(card);
    updateGlobalSummary();
}

/**
 * =========================================================
 * INICIALIZAR SUBTOTALES
 * =========================================================
 */
function inicializarSubtotales() {
    const cards = document.querySelectorAll(".specialty-card");
    cards.forEach(card => calculateSpecialtySubtotal(card));
}

/**
 * =========================================================
 * OBTENER SPECIALTIES PARA RESUMEN Y PAYLOAD
 * ---------------------------------------------------------
 * Se conserva la estructura esperada por backend:
 * - labor/materials/equipment/others en 0
 * - subtotal real de la specialty
 * =========================================================
 */
function obtenerSpecialties() {
    const cards = document.querySelectorAll(".specialty-card");

    return Array.from(cards).map(card => {
        const nameInput = card.querySelector(".specialty-name-input");
        const subtotalEl = card.querySelector(".specialty-total-display");

        return {
            name: nameInput ? nameInput.value.trim() : "",
            labor: 0,
            materials: 0,
            equipment: 0,
            others: 0,
            subtotal: subtotalEl
                ? Number(subtotalEl.textContent.replace(/[$,]/g, "")) || 0
                : 0
        };
    });
}

/**
 * =========================================================
 * RESUMEN GLOBAL
 * =========================================================
 */
function updateGlobalSummary() {
    const specialties = obtenerSpecialties();

    const baseTotal = specialties.reduce((sum, item) => {
        return sum + Number(item.subtotal || 0);
    }, 0);

    const managementFeeInput = document.getElementById("management-fee-input");
    const managementFeePercent = Number(managementFeeInput?.value || 0);
    const managementFeeAmount = baseTotal * (managementFeePercent / 100);
    const grandTotal = baseTotal + managementFeeAmount;

    const totalDisplay = document.getElementById("total-budget-amount");
    if (totalDisplay) {
        totalDisplay.textContent = grandTotal.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    const totalArea = Number(document.getElementById("total-area-input")?.value || 0);
    const costPerSfDisplay = document.getElementById("cost-per-sf-display");

    if (costPerSfDisplay) {
        if (totalArea > 0) {
            const costPerSf = grandTotal / totalArea;
            costPerSfDisplay.textContent = `$${costPerSf.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })}`;
        } else {
            costPerSfDisplay.textContent = "--";
        }
    }

    const specialtiesCountDisplay = document.getElementById("specialties-count-display");
    if (specialtiesCountDisplay) {
        specialtiesCountDisplay.textContent = String(specialties.length);
    }

    const breakdownContainer = document.getElementById("breakdown-list");
    if (!breakdownContainer) return;

    breakdownContainer.innerHTML = "";

    if (!specialties.length) {
        breakdownContainer.innerHTML = `
            <p class="text-on-surface-variant text-[10px] uppercase font-bold tracking-widest">
                No specialties added
            </p>
        `;
        return;
    }

    const maxSubtotal = Math.max(...specialties.map(item => Number(item.subtotal || 0)), 0);

    specialties.forEach(spec => {
        const subtotal = Number(spec.subtotal || 0);
        const widthPercent = maxSubtotal > 0 ? Math.max((subtotal / maxSubtotal) * 100, 6) : 0;

        const row = document.createElement("div");
        row.className = "flex justify-between items-center gap-4 group cursor-pointer";

        row.innerHTML = `
            <div class="space-y-0.5 min-w-0">
                <p class="text-on-surface-variant font-bold text-[10px] uppercase tracking-widest group-hover:text-on-surface transition-colors">
                    ${escapeHtml(spec.name || "Unnamed Specialty")}
                </p>
                <div class="w-16 h-1 bg-primary/20 rounded-full overflow-hidden">
                    <div class="bg-primary h-full" style="width: ${widthPercent}%"></div>
                </div>
            </div>
            <span class="text-on-surface font-bold text-sm font-mono tracking-tight shrink-0">
                $${subtotal.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                })}
            </span>
        `;

        breakdownContainer.appendChild(row);
    });
}

/**
 * =========================================================
 * HELPERS
 * =========================================================
 */
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatBudgetDate(value) {
    if (!value) return "No date";

    const date = new Date(value);
    if (isNaN(date.getTime())) return "No date";

    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit"
    });
}

/**
 * =========================================================
 * PAYLOAD PARA GUARDADO
 * =========================================================
 */
function obtenerBudgetPayload() {
    const budgetIdText = document.getElementById("budget-id-display")?.textContent || "";
    const budgetId = budgetIdText.replace("Budget ID:", "").trim();

    const clientName = document.getElementById("client-name-input")?.value || "";
    const serviceCategory = document.getElementById("service-category-input")?.value || "";
    const projectName = document.getElementById("project-name-input")?.value || "";
    const location = document.getElementById("location-input")?.value || "";
    const totalArea = Number(document.getElementById("total-area-input")?.value || 0);
    const managementFeePercent = Number(document.getElementById("management-fee-input")?.value || 0);

    const specialties = obtenerSpecialties();
    const baseTotal = specialties.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const managementFeeAmount = baseTotal * (managementFeePercent / 100);
    const total = baseTotal + managementFeeAmount;

    return {
        internalId: currentEditingInternalId,
        budgetId,
        clientName,
        serviceCategory,
        projectName,
        location,
        totalArea,
        managementFeePercent,
        specialties,
        total
    };
}

/**
 * =========================================================
 * GUARDAR / ACTUALIZAR BUDGET
 * =========================================================
 */
async function guardarBudget() {
    if (isReadOnlyMode) return;

    const button = document.getElementById("save-budget-btn");

    try {
        if (button) {
            button.disabled = true;
            button.classList.add("opacity-50", "cursor-not-allowed");
            button.textContent = currentEditingInternalId ? "Updating..." : "Saving...";
        }

        const payload = obtenerBudgetPayload();
        const isEditing = !!payload.internalId;

        console.log("Payload a guardar:", payload);

        if (!payload.budgetId || payload.budgetId === "Loading..." || payload.budgetId === "Error") {
            throw new Error("Budget ID no disponible.");
        }

        if (!payload.projectName.trim()) {
            throw new Error("Project Name es obligatorio.");
        }

        if (payload.specialties.length === 0) {
            throw new Error("Debe existir al menos una especialidad.");
        }

        const response = await fetch(BACKEND_URL, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain;charset=utf-8"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || "Error al guardar.");
        }

        if (button) {
            button.textContent = isEditing ? "Updated ✓" : "Saved ✓";
        }

        if (!isEditing) {
            resetFormulario();
            await obtenerIdOficial();
        }

        setTimeout(() => {
            if (button) {
                button.disabled = false;
                button.classList.remove("opacity-50", "cursor-not-allowed");
                button.textContent = "Save";
            }
        }, 1500);

    } catch (error) {
        console.error("Error al guardar:", error);
        alert(error.message || "Error al guardar el presupuesto.");

        if (button) {
            button.disabled = false;
            button.classList.remove("opacity-50", "cursor-not-allowed");
            button.textContent = "Save";
        }
    }
}

/**
 * =========================================================
 * RESET FORMULARIO
 * =========================================================
 */
function resetFormulario() {
    currentEditingInternalId = null;

    const saveBudgetButton = document.getElementById("save-budget-btn");
    if (saveBudgetButton) {
        saveBudgetButton.textContent = "Save";
    }

    const clientSelect = document.getElementById("client-name-input");
    const serviceInput = document.getElementById("service-category-input");
    const projectInput = document.getElementById("project-name-input");
    const locationInput = document.getElementById("location-input");
    const totalAreaInput = document.getElementById("total-area-input");
    const managementFeeInput = document.getElementById("management-fee-input");

    if (clientSelect) clientSelect.selectedIndex = 0;
    if (serviceInput) serviceInput.value = "";
    if (projectInput) projectInput.value = "";
    if (locationInput) locationInput.value = "";
    if (totalAreaInput) totalAreaInput.value = "";
    if (managementFeeInput) managementFeeInput.value = "10";

    const container = document.getElementById("specialties-container");
    const template = document.getElementById("specialty-template");

    if (!container || !template) return;

    container.innerHTML = "";

    const clone = template.content.cloneNode(true);
    container.appendChild(clone);

    const newCard = container.firstElementChild;
    if (!newCard) return;

    const amountInput = newCard.querySelector(".specialty-amount-input");
    const nameInput = newCard.querySelector(".specialty-name-input");
    const body = newCard.querySelector(".specialty-body");
    const toggleIcon = newCard.querySelector(".specialty-toggle-btn .material-symbols-outlined");

    if (amountInput) {
        amountInput.value = "";
        amountInput.disabled = false;
        amountInput.classList.remove("opacity-40", "pointer-events-none");
    }

    if (nameInput) {
        nameInput.value = "New Specialty";
        nameInput.removeAttribute("readonly");
    }

    if (body) body.classList.remove("hidden");

    if (toggleIcon) {
        toggleIcon.textContent = "expand_less";
    }

    newCard.classList.remove("is-collapsed");

    calculateSpecialtySubtotal(newCard);
    updateAddLineButtonState(newCard);
}

/**
 * =========================================================
 * CARGAR BUDGET EN FORMULARIO
 * ---------------------------------------------------------
 * El backend hoy persiste specialties con subtotal, no line items.
 * Por eso se carga el subtotal como amount directo.
 * =========================================================
 */
function cargarBudgetEnFormulario(budget) {
    const budgetIdDisplay = document.getElementById("budget-id-display");
    const clientSelect = document.getElementById("client-name-input");
    const serviceInput = document.getElementById("service-category-input");
    const projectInput = document.getElementById("project-name-input");
    const locationInput = document.getElementById("location-input");
    const totalAreaInput = document.getElementById("total-area-input");
    const managementFeeInput = document.getElementById("management-fee-input");
    const container = document.getElementById("specialties-container");
    const template = document.getElementById("specialty-template");

    if (budgetIdDisplay) {
        budgetIdDisplay.textContent = `Budget ID: ${budget.budgetId || ""}`;
    }

    if (clientSelect) clientSelect.value = budget.clientName || "";
    if (serviceInput) serviceInput.value = budget.serviceCategory || "";
    if (projectInput) projectInput.value = budget.projectName || "";
    if (locationInput) locationInput.value = budget.location || "";
    if (totalAreaInput) totalAreaInput.value = budget.totalArea || "";
    if (managementFeeInput) managementFeeInput.value = budget.managementFeePercent || 0;

    if (!container || !template) {
        updateGlobalSummary();
        return;
    }

    container.innerHTML = "";

    const specialties = Array.isArray(budget.specialties) ? budget.specialties : [];

    if (!specialties.length) {
        const clone = template.content.cloneNode(true);
        container.appendChild(clone);

        const newCard = container.firstElementChild;
        if (newCard) {
            calculateSpecialtySubtotal(newCard);
            updateAddLineButtonState(newCard);
        }

        updateGlobalSummary();
        return;
    }

    specialties.forEach(spec => {
        const clone = template.content.cloneNode(true);
        container.appendChild(clone);

        const card = container.lastElementChild;
        if (!card) return;

        const nameInput = card.querySelector(".specialty-name-input");
        const amountInput = card.querySelector(".specialty-amount-input");

        if (nameInput) {
            nameInput.value = spec.name || "New Specialty";
        }

        if (amountInput) {
            amountInput.value = Number(spec.subtotal || 0) || "";
        }

        calculateSpecialtySubtotal(card);
        updateAddLineButtonState(card);
    });

    updateGlobalSummary();
}

/**
 * =========================================================
 * MODOS DE LECTURA / EDICIÓN
 * =========================================================
 */
function abrirBudgetEnModoLectura(internalId) {
    const budget = budgetsCache.find(item => String(item.internalId) === String(internalId));
    if (!budget) {
        alert("Could not find the selected budget.");
        return;
    }

    currentEditingInternalId = null;

    cargarBudgetEnFormulario(budget);
    activarModoSoloLectura();
    closeBudgetsDrawer();

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function activarModoSoloLectura() {
    isReadOnlyMode = true;
    document.body.classList.add("budget-readonly-mode");

    const budgetModeBadge = document.getElementById("budget-mode-badge");
    if (budgetModeBadge) {
        budgetModeBadge.classList.remove("hidden");
    }

    const validationBox = document.getElementById("budget-validation-box");
    if (validationBox) {
        validationBox.classList.add("hidden");
    }

    const mainFields = [
        document.getElementById("client-name-input"),
        document.getElementById("service-category-input"),
        document.getElementById("project-name-input"),
        document.getElementById("location-input"),
        document.getElementById("total-area-input"),
        document.getElementById("management-fee-input")
    ];

    mainFields.forEach(field => {
        if (!field) return;
        field.setAttribute("disabled", "true");
    });

    const addSpecialtyButton = document.getElementById("add-specialty-btn");
    const saveBudgetButton = document.getElementById("save-budget-btn");
    const viewBudgetsButton = document.getElementById("view-budgets-btn");
    const approveBudgetButton = document.getElementById("approve-budget-btn");
    const closeReadonlyButton = document.getElementById("close-readonly-btn");

    if (addSpecialtyButton) {
        addSpecialtyButton.setAttribute("disabled", "true");
        addSpecialtyButton.classList.add("hidden");
    }

    if (saveBudgetButton) {
        saveBudgetButton.setAttribute("disabled", "true");
        saveBudgetButton.classList.add("hidden");
    }

    if (viewBudgetsButton) {
        viewBudgetsButton.setAttribute("disabled", "true");
        viewBudgetsButton.classList.add("hidden");
    }

    if (approveBudgetButton) {
        approveBudgetButton.setAttribute("disabled", "true");
        approveBudgetButton.classList.add("hidden");
    }

    if (closeReadonlyButton) {
        closeReadonlyButton.classList.remove("hidden");
    }

    const specialtyCards = document.querySelectorAll(".specialty-card");

    specialtyCards.forEach(card => {
        const nameInput = card.querySelector(".specialty-name-input");
        const numberInputs = card.querySelectorAll('input[type="number"]');
        const deleteBtn = card.querySelector(".delete-specialty-btn");
        const saveBtn = card.querySelector(".save-specialty-btn");
        const addLineBtn = card.querySelector(".add-line-item-btn");
        const lineDeleteBtns = card.querySelectorAll(".delete-line-item-btn");
        const lineToggleBtns = card.querySelectorAll(".line-item-toggle-btn");
        const specialtyToggleBtn = card.querySelector(".specialty-toggle-btn");

        if (nameInput) {
            nameInput.setAttribute("readonly", "true");
            nameInput.classList.add("pointer-events-none");
        }

        numberInputs.forEach(input => {
            input.setAttribute("disabled", "true");
        });

        if (deleteBtn) deleteBtn.classList.add("hidden");
        if (saveBtn) saveBtn.classList.add("hidden");
        if (addLineBtn) addLineBtn.classList.add("hidden");
        if (specialtyToggleBtn) specialtyToggleBtn.classList.add("pointer-events-none");

        lineDeleteBtns.forEach(btn => btn.classList.add("hidden"));
        lineToggleBtns.forEach(btn => btn.classList.add("pointer-events-none"));
    });
}

function desactivarModoSoloLectura() {
    isReadOnlyMode = false;
    document.body.classList.remove("budget-readonly-mode");

    const budgetModeBadge = document.getElementById("budget-mode-badge");
    if (budgetModeBadge) {
        budgetModeBadge.classList.add("hidden");
    }

    const validationBox = document.getElementById("budget-validation-box");
    if (validationBox) {
        validationBox.classList.remove("hidden");
    }

    const mainFields = [
        document.getElementById("client-name-input"),
        document.getElementById("service-category-input"),
        document.getElementById("project-name-input"),
        document.getElementById("location-input"),
        document.getElementById("total-area-input"),
        document.getElementById("management-fee-input")
    ];

    mainFields.forEach(field => {
        if (!field) return;
        field.removeAttribute("disabled");
    });

    const addSpecialtyButton = document.getElementById("add-specialty-btn");
    const saveBudgetButton = document.getElementById("save-budget-btn");
    const viewBudgetsButton = document.getElementById("view-budgets-btn");
    const approveBudgetButton = document.getElementById("approve-budget-btn");
    const closeReadonlyButton = document.getElementById("close-readonly-btn");

    if (addSpecialtyButton) {
        addSpecialtyButton.removeAttribute("disabled");
        addSpecialtyButton.classList.remove("hidden");
    }

    if (saveBudgetButton) {
        saveBudgetButton.removeAttribute("disabled");
        saveBudgetButton.classList.remove("hidden");
    }

    if (viewBudgetsButton) {
        viewBudgetsButton.removeAttribute("disabled");
        viewBudgetsButton.classList.remove("hidden");
    }

    if (approveBudgetButton) {
        approveBudgetButton.removeAttribute("disabled");
        approveBudgetButton.classList.remove("hidden");
    }

    if (closeReadonlyButton) {
        closeReadonlyButton.classList.add("hidden");
    }

    const specialtyCards = document.querySelectorAll(".specialty-card");

    specialtyCards.forEach(card => {
        const nameInput = card.querySelector(".specialty-name-input");
        const numberInputs = card.querySelectorAll('input[type="number"]');
        const deleteBtn = card.querySelector(".delete-specialty-btn");
        const saveBtn = card.querySelector(".save-specialty-btn");
        const addLineBtn = card.querySelector(".add-line-item-btn");
        const lineDeleteBtns = card.querySelectorAll(".delete-line-item-btn");
        const lineToggleBtns = card.querySelectorAll(".line-item-toggle-btn");
        const specialtyToggleBtn = card.querySelector(".specialty-toggle-btn");

        if (nameInput) {
            nameInput.removeAttribute("readonly");
            nameInput.classList.remove("pointer-events-none");
        }

        numberInputs.forEach(input => {
            input.removeAttribute("disabled");
        });

        if (deleteBtn) deleteBtn.classList.remove("hidden");
        if (saveBtn) saveBtn.classList.remove("hidden");
        if (addLineBtn) addLineBtn.classList.remove("hidden");
        if (specialtyToggleBtn) specialtyToggleBtn.classList.remove("pointer-events-none");

        lineDeleteBtns.forEach(btn => btn.classList.remove("hidden"));
        lineToggleBtns.forEach(btn => btn.classList.remove("pointer-events-none"));
    });
}

function abrirBudgetParaEdicion(internalId) {
    const budget = budgetsCache.find(item => String(item.internalId) === String(internalId));
    if (!budget) {
        alert("Could not find the selected budget.");
        return;
    }

    currentEditingInternalId = String(budget.internalId || "").trim();

    cargarBudgetEnFormulario(budget);
    desactivarModoSoloLectura();
    closeBudgetsDrawer();

    const saveBudgetButton = document.getElementById("save-budget-btn");
    if (saveBudgetButton) {
        saveBudgetButton.textContent = "Update";
    }

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function cerrarModoLecturaYVolverAPresupuestos() {
    desactivarModoSoloLectura();
    resetFormulario();
    obtenerIdOficial();
    openBudgetsDrawer();

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

/**
 * =========================================================
 * CONTROL DEL BOTÓN "ADD LINE"
 * ---------------------------------------------------------
 * Si hay monto directo:
 * - deshabilita Add Line
 * - borra líneas existentes para evitar mezcla de modos
 *
 * Si no hay monto:
 * - habilita Add Line
 * =========================================================
 */
function updateAddLineButtonState(specialtyCard) {
    if (!specialtyCard) return;

    const amountInput = specialtyCard.querySelector(".specialty-amount-input");
    const addLineButton = specialtyCard.querySelector(".add-line-item-btn");
    const lineItemsContainer = specialtyCard.querySelector(".line-items-container");

    if (!amountInput || !addLineButton) return;

    const amountValue = Number(amountInput.value || 0);
    const hasDirectAmount = amountValue > 0;

    if (hasDirectAmount) {
        addLineButton.disabled = true;
        addLineButton.classList.add("opacity-40", "pointer-events-none");
        addLineButton.setAttribute("aria-disabled", "true");

        // Modo exclusivo: si existe amount, las líneas se limpian
        if (lineItemsContainer) {
            lineItemsContainer.innerHTML = "";
        }
    } else {
        addLineButton.disabled = false;
        addLineButton.classList.remove("opacity-40", "pointer-events-none");
        addLineButton.removeAttribute("aria-disabled");
    }
}




function updateLineItemHeaderAmount(lineItemRow) {
    if (!lineItemRow) return;

    const amountInput = lineItemRow.querySelector(".line-item-amount-input");
    const amountDisplay = lineItemRow.querySelector(".line-item-amount-display");

    const amount = Number(amountInput?.value || 0);

    if (amountDisplay) {
        amountDisplay.textContent = `$${amount.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    }
}
