/**
 * =========================================================
 * ART'DHOME ERP - FRONTEND LOGIC
 * Conexión con Google Apps Script + manejo de especialidades
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
     * VALIDACIÓN BÁSICA DE ELEMENTOS DEL DOM
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
        container.appendChild(clone);

        const newCard = container.lastElementChild;
        if (!newCard) return;

        const specialtyNameInput = newCard.querySelector('input[type="text"]');
        if (specialtyNameInput) {
            specialtyNameInput.focus();
            specialtyNameInput.select();
        }

        calculateSpecialtySubtotal(newCard);
    });

    /**
     * =========================================================
     * EVENTO DELEGADO: CLICK EN ESPECIALIDADES
     * =========================================================
     */
    container.addEventListener("click", function (event) {
    const toggleButton = event.target.closest(".material-symbols-outlined");
    if (
        toggleButton &&
        (toggleButton.textContent.trim() === "expand_less" ||
         toggleButton.textContent.trim() === "expand_more")
    ) {
        const specialtyCard = toggleButton.closest(".specialty-card");
        if (!specialtyCard) return;

        const specialtyBody = specialtyCard.querySelector(".specialty-body");
        const nameInput = specialtyCard.querySelector('input[type="text"]');

        if (!specialtyBody) return;

        const isHidden = specialtyBody.classList.contains("hidden");

        if (isHidden) {
            specialtyBody.classList.remove("hidden");
            toggleButton.textContent = "expand_less";

            if (nameInput && !isReadOnlyMode) {
                nameInput.removeAttribute("readonly");
            }
        } else {
            specialtyBody.classList.add("hidden");
            toggleButton.textContent = "expand_more";

            if (nameInput) {
                nameInput.setAttribute("readonly", "true");
            }
        }

        return;
    }

    if (isReadOnlyMode) return;

    const deleteButton = event.target.closest(".delete-specialty-btn");
    if (deleteButton) {
        const specialtyCard = deleteButton.closest(".specialty-card");
        if (specialtyCard) {
            specialtyCard.remove();
            updateGlobalSummary();
        }
        return;
    }

    const saveSpecialtyButton = event.target.closest('[aria-label="Guardar especialidad"]');
    if (saveSpecialtyButton) {
        const specialtyCard = saveSpecialtyButton.closest(".specialty-card");
        if (!specialtyCard) return;

        const nameInput = specialtyCard.querySelector('input[type="text"]');
        const specialtyBody = specialtyCard.querySelector(".specialty-body");
        const toggleIcon = specialtyCard.querySelector(".material-symbols-outlined");

        if (!nameInput || !specialtyBody) return;

        const specialtyName = nameInput.value.trim();

        if (specialtyName === "") {
            alert("Please enter a specialty name.");
            nameInput.focus();
            return;
        }

        specialtyBody.classList.add("hidden");
        nameInput.setAttribute("readonly", "true");

        if (toggleIcon) {
            toggleIcon.textContent = "expand_more";
        }

        return;
    }
});

    /**
     * =========================================================
     * EVENTO DELEGADO: INPUT EN ESPECIALIDADES
     * =========================================================
     */
    container.addEventListener("input", function (event) {
        if (isReadOnlyMode) return;

        if (event.target.matches('.specialty-body input[type="number"]')) {
            const specialtyCard = event.target.closest(".specialty-card");
            if (specialtyCard) {
                calculateSpecialtySubtotal(specialtyCard);
            }
            return;
        }

        if (event.target.matches('.specialty-card input[type="text"]')) {
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

function actualizarFechaActual() {
    const dateElement = document.getElementById("current-date-display");
    if (!dateElement) return;

    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();

    dateElement.textContent = `Date: ${day}/${month}/${year}`;
}

function calculateSpecialtySubtotal(card) {
    const inputs = card.querySelectorAll('.specialty-body input[type="number"]');
    let total = 0;

    inputs.forEach(input => {
        const value = parseFloat(input.value) || 0;
        total += value;
    });

    const subtotalElement = card.querySelector(".specialty-subtotal");

    if (subtotalElement) {
        subtotalElement.textContent = `$${total.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    }

    updateGlobalSummary();
}

function inicializarSubtotales() {
    const cards = document.querySelectorAll(".specialty-card");
    cards.forEach(card => calculateSpecialtySubtotal(card));
}

function obtenerSpecialties() {
    const cards = document.querySelectorAll(".specialty-card");

    return Array.from(cards).map(card => {
        const nameInput = card.querySelector('input[type="text"]');
        const numberInputs = card.querySelectorAll('.specialty-body input[type="number"]');
        const subtotalEl = card.querySelector(".specialty-subtotal");

        return {
            name: nameInput ? nameInput.value.trim() : "",
            labor: Number(numberInputs[0]?.value || 0),
            materials: Number(numberInputs[1]?.value || 0),
            equipment: Number(numberInputs[2]?.value || 0),
            others: Number(numberInputs[3]?.value || 0),
            subtotal: subtotalEl
                ? Number(subtotalEl.textContent.replace(/[$,]/g, "")) || 0
                : 0
        };
    });
}

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

        // Si era creación nueva, sí limpiamos el formulario y generamos nuevo ID
        if (!isEditing) {
            resetFormulario();
            await obtenerIdOficial();
        }

        // Si era edición, NO limpiamos el formulario.
        // Dejamos currentEditingInternalId intacto para seguir editando.

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

    const numberInputs = newCard.querySelectorAll('.specialty-body input[type="number"]');
    numberInputs.forEach(input => input.value = 0);

    const nameInput = newCard.querySelector('input[type="text"]');
    if (nameInput) {
        nameInput.value = "New Specialty";
        nameInput.removeAttribute("readonly");
    }

    const body = newCard.querySelector(".specialty-body");
    if (body) body.classList.remove("hidden");

    const icon = newCard.querySelector(".material-symbols-outlined");
    if (icon) icon.textContent = "expand_less";

    calculateSpecialtySubtotal(newCard);
}

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
        }

        updateGlobalSummary();
        return;
    }

    specialties.forEach(spec => {
        const clone = template.content.cloneNode(true);
        container.appendChild(clone);

        const card = container.lastElementChild;
        if (!card) return;

        const nameInput = card.querySelector('input[type="text"]');
        const numberInputs = card.querySelectorAll('.specialty-body input[type="number"]');

        if (nameInput) {
            nameInput.value = spec.name || "New Specialty";
        }

        if (numberInputs[0]) numberInputs[0].value = spec.labor || 0;
        if (numberInputs[1]) numberInputs[1].value = spec.materials || 0;
        if (numberInputs[2]) numberInputs[2].value = spec.equipment || 0;
        if (numberInputs[3]) numberInputs[3].value = spec.others || 0;

        calculateSpecialtySubtotal(card);
    });

    updateGlobalSummary();
}

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
        const nameInput = card.querySelector('input[type="text"]');
        const numberInputs = card.querySelectorAll('.specialty-body input[type="number"]');
        const deleteBtn = card.querySelector(".delete-specialty-btn");
        const saveBtn = card.querySelector('[aria-label="Guardar especialidad"]');

        if (nameInput) {
            nameInput.setAttribute("readonly", "true");
            nameInput.classList.add("pointer-events-none");
        }

        numberInputs.forEach(input => {
            input.setAttribute("disabled", "true");
        });

        if (deleteBtn) {
            deleteBtn.classList.add("hidden");
        }

        if (saveBtn) {
            saveBtn.classList.add("hidden");
        }
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
        const nameInput = card.querySelector('input[type="text"]');
        const numberInputs = card.querySelectorAll('.specialty-body input[type="number"]');
        const deleteBtn = card.querySelector(".delete-specialty-btn");
        const saveBtn = card.querySelector('[aria-label="Guardar especialidad"]');

        if (nameInput) {
            nameInput.removeAttribute("readonly");
            nameInput.classList.remove("pointer-events-none");
        }

        numberInputs.forEach(input => {
            input.removeAttribute("disabled");
        });

        if (deleteBtn) {
            deleteBtn.classList.remove("hidden");
        }

        if (saveBtn) {
            saveBtn.classList.remove("hidden");
        }
    });
}

function abrirBudgetParaEdicion(internalId) {
    const budget = budgetsCache.find(item => String(item.internalId) === String(internalId));
    if (!budget) {
        alert("Could not find the selected budget.");
        return;
    }

    currentEditingInternalId = String(budget.internalId || '').trim();

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