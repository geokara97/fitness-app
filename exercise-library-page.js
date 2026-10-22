// ============================================================
// Exercise Library — add, edit, hide and delete exercises
// ============================================================

let libSplits = [];
let libExercises = [];
let editingId = null;   // exercise_id being edited, or null when adding

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('exercise');

    document.getElementById('lib-form').addEventListener('submit', saveExercise);
    document.getElementById('lib-cancel').addEventListener('click', resetForm);
    document.getElementById('lib-search').addEventListener('input', renderList);
    document.getElementById('lib-filter-split').addEventListener('input', renderList);
    document.getElementById('lib-list').addEventListener('click', onListClick);

    try {
        [libSplits, libExercises] = await Promise.all([fetchSplits(), fetchExercises({ includeHidden: true })]);
    } catch (err) {
        showToast(t('wo.dbUpgrade'), 'error');
        return;
    }

    document.getElementById('lib-filter-split').innerHTML =
        `<option value="">${escapeHtml(t('lib.allSplits'))}</option>` +
        libSplits.map(s => `<option value="${s.split_id}">${escapeHtml(splitLabel(s))}</option>`).join('');
    resetForm();
    renderList();
});

// ---- Form ---------------------------------------------------
function resetForm() {
    editingId = null;
    document.getElementById('lib-form').reset();
    document.getElementById('lib-splits').innerHTML = splitChecksHtml(libSplits, new Set(), 'lib-split');
    document.getElementById('lib-form-title').textContent = t('lib.addTitle');
    document.getElementById('lib-cancel').hidden = true;
}

function startEdit(ex) {
    editingId = ex.exercise_id;
    document.getElementById('lib-name-en').value = ex.exercise_name;
    document.getElementById('lib-name-el').value = ex.exercise_name_el || '';
    document.getElementById('lib-measure').value = isTimedExercise(ex) ? 'time' : 'reps';
    document.getElementById('lib-splits').innerHTML = splitChecksHtml(libSplits, new Set(ex.splitIds), 'lib-split');
    document.getElementById('lib-form-title').textContent = t('lib.editTitle', { name: exerciseLabel(ex) });
    document.getElementById('lib-cancel').hidden = false;
    document.getElementById('lib-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('lib-name-en').focus();
}

async function saveExercise(e) {
    e.preventDefault();
    const fields = {
        nameEn: document.getElementById('lib-name-en').value.trim(),
        nameEl: document.getElementById('lib-name-el').value.trim(),
        measure: document.getElementById('lib-measure').value,
        splitIds: checkedSplitIds('lib-split'),
    };
    if (!fields.nameEn) return;
    if (!fields.splitIds.length) { showToast(t('wo.nxNeedSplit'), 'error'); return; }

    const btn = document.getElementById('lib-save');
    btn.disabled = true;
    try {
        if (editingId) {
            const updated = await updateExercise(editingId, fields);
            libExercises = libExercises.map(x => x.exercise_id === editingId ? { ...x, ...updated } : x);
            showToast(t('lib.updated', { name: exerciseLabel(updated) }));
        } else {
            const created = await createExercise(fields);
            libExercises.push(created);
            showToast(t('wo.nxAdded', { name: exerciseLabel(created) }));
        }
        resetForm();
        renderList();
    } catch (err) {
        showToast(exerciseErrorMessage(err), 'error');
    } finally {
        btn.disabled = false;
    }
}

// ---- List ---------------------------------------------------
function renderList() {
    const q = document.getElementById('lib-search').value.trim().toLowerCase();
    const splitId = Number(document.getElementById('lib-filter-split').value) || null;
    const splitById = Object.fromEntries(libSplits.map(s => [s.split_id, s]));

    const shown = libExercises
        .filter(ex => !splitId || ex.splitIds.includes(splitId))
        .filter(ex => !q || `${ex.exercise_name} ${ex.exercise_name_el || ''}`.toLowerCase().includes(q))
        .sort((a, b) => exerciseLabel(a).localeCompare(exerciseLabel(b), LOCALE));

    document.getElementById('lib-count').textContent = t('lib.count', { n: shown.length, total: libExercises.length });

    const list = document.getElementById('lib-list');
    if (!shown.length) {
        list.innerHTML = `<div class="empty"><div class="icon">🔍</div><p>${escapeHtml(t('lib.noMatch'))}</p></div>`;
        return;
    }

    list.innerHTML = shown.map(ex => {
        const other = LANG === 'el' ? ex.exercise_name : ex.exercise_name_el;
        const badges = ex.splitIds
            .map(id => splitById[id]).filter(Boolean)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(s => `<span class="badge blue">${escapeHtml(splitLabel(s))}</span>`).join(' ');
        return `
            <div class="food-row ${ex.is_active ? '' : 'is-hidden'}">
                <div class="food-info">
                    <strong>${escapeHtml(exerciseLabel(ex))}</strong>
                    ${other && other !== exerciseLabel(ex) ? `<span class="muted text-sm">${escapeHtml(other)}</span>` : ''}
                    ${ex.is_custom ? `<span class="badge gray">${escapeHtml(t('lib.custom'))}</span>` : ''}
                    ${ex.is_active ? '' : `<span class="badge red">${escapeHtml(t('lib.hidden'))}</span>`}
                    <div class="split-badges">${badges || `<span class="muted text-sm">${escapeHtml(t('lib.noSplits'))}</span>`}</div>
                </div>
                <div class="pref-btns">
                    <button type="button" class="pref-btn active" data-act="edit" data-id="${ex.exercise_id}" title="${escapeHtml(t('lib.edit'))}">✏️</button>
                    <button type="button" class="pref-btn active" data-act="toggle" data-id="${ex.exercise_id}"
                            title="${escapeHtml(t(ex.is_active ? 'lib.hide' : 'lib.show'))}">${ex.is_active ? '🙈' : '👁️'}</button>
                    <button type="button" class="icon-btn" data-act="delete" data-id="${ex.exercise_id}" title="${escapeHtml(t('common.delete'))}">×</button>
                </div>
            </div>`;
    }).join('');
}

async function onListClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const ex = libExercises.find(x => x.exercise_id === Number(btn.dataset.id));
    if (!ex) return;
    if (btn.dataset.act === 'edit') startEdit(ex);
    if (btn.dataset.act === 'toggle') setActive(ex, !ex.is_active);
    if (btn.dataset.act === 'delete') deleteExercise(ex);
}

// Hidden exercises stay in history but no longer appear when logging a workout.
async function setActive(ex, active) {
    const { error } = await db.from('exercises').update({ is_active: active }).eq('exercise_id', ex.exercise_id);
    if (error) { showToast(t('common.error', { msg: error.message }), 'error'); return; }
    ex.is_active = active;
    renderList();
    showToast(t(active ? 'lib.shown' : 'lib.hiddenToast', { name: exerciseLabel(ex) }));
}

async function deleteExercise(ex) {
    if (!(await confirmToast(t('lib.confirmDelete', { name: exerciseLabel(ex) }), { okText: t('common.delete') }))) return;
    const { error } = await db.from('exercises').delete().eq('exercise_id', ex.exercise_id);
    if (error) {
        // Used in logged workouts: offer to hide it instead.
        if (error.code === '23503') {
            if (ex.is_active && await confirmToast(t('lib.inUseHide', { name: exerciseLabel(ex) }), { okText: t('lib.hideBtn') })) await setActive(ex, false);
            else if (!ex.is_active) showToast(t('lib.inUse'), 'error');
            return;
        }
        showToast(t('common.error', { msg: error.message }), 'error');
        return;
    }
    libExercises = libExercises.filter(x => x.exercise_id !== ex.exercise_id);
    if (editingId === ex.exercise_id) resetForm();
    renderList();
    showToast(t('lib.deleted'));
}
