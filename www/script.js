document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const personTypes = ['M.S.', 'M.S.Y.', 'G.T.', 'PER.', 'PER.', 'PER.'];
    const daysOfWeek = ['Pzt', 'Salı', 'Çrş', 'Prş', 'Cuma', 'Cmt', 'Paz'];
    const shiftDefinitions = {
        '08.45-15.45': { netHours: 6, type: 'early' },
        '08.45-16.45': { netHours: 7, type: 'early' },
        '08.45-17.45': { netHours: 7.5, type: 'early' },
        '08.45-18.15': { netHours: 8, type: 'early' },
        '08.45-18.45': { netHours: 8.5, type: 'early' },
        '12.15-21.15': { netHours: 7.5, type: 'late' },
        '14.15-21.15': { netHours: 6, type: 'late' },
        '14.45-21.15': { netHours: 5.5, type: 'late' },
        '15.45-21.15': { netHours: 5, type: 'late' },
        '16.45-21.15': { netHours: 4, type: 'late' },
        'A': { netHours: 9, type: 'external' },
        'FULL': { netHours: 11, type: 'external' },
        'B': { netHours: 0, type: 'leave' },
        'R': { netHours: 0, type: 'leave' },
        'Y': { netHours: 0, type: 'leave' },
        'M': { netHours: 0, type: 'leave' }
    };
    const manualOnlyShifts = ['R', 'Y', 'M'];
    const planningShifts = Object.keys(shiftDefinitions).filter(s => !manualOnlyShifts.includes(s) && s !== 'B' && s !== 'A' && s !== 'FULL');
    const earlyShifts = Object.keys(shiftDefinitions).filter(s => shiftDefinitions[s].type === 'early');
    const lateShifts = Object.keys(shiftDefinitions).filter(s => shiftDefinitions[s].type === 'late');
    const openingShifts = Object.keys(shiftDefinitions).filter(s => s.startsWith('08.45'));
    const leaveTypes = ['B', 'R', 'Y', 'M'];
    const unpasifableTypes = ['M.S.', 'M.S.Y.', 'G.T.'];
    const toggleableRowIndices = [4, 5];
    const fridayIndex = 4;
    const specialDayTypes = ['Toplantı Günleri', 'Sevkiyat Günleri', 'Tat-Num Testi Günleri', 'El İlanı Dağıtım Günleri'];

    // --- STATE ---
    let isLocked = false,
        isShuffling = false;
    let searchTimeoutId = null;
    let manuallyEditedCells = new Set(),
        preLockEdits = new Set();
    let activePersonnel = {},
        specialDays = {};
    specialDayTypes.forEach(type => specialDays[type.replace(/ /g, '')] = []);

    // --- DOM ELEMENTS ---
    const appContainer = document.getElementById('app-container');
    const scheduleBody = document.getElementById('schedule-body');
    const notificationContainer = document.getElementById('notification-container');
    const lockButton = document.getElementById('action-lock');
    const shuffleButton = document.getElementById('action-shuffle');
    const downloadButton = document.getElementById('action-download');
    const drawerToggleButton = document.getElementById('action-drawer');
    const addRowBtn = document.getElementById('add-row-btn');
    const drawer = document.getElementById('special-days-drawer');
    const overlay = document.getElementById('overlay');

    // --- HELPER FUNCTIONS ---
    const showNotification = (message, type, options = {}) => {
        const {
            isHtml = false, title = ''
        } = options;
        const duration = 5000;
        const id = `notif-${Date.now()}`;
        const notification = document.createElement('div');
        notification.id = id;
        notification.className = `notification ${type}`;

        let finalMessage = '';
        if (title) {
            finalMessage = `<strong>${title}</strong><div style="margin-top:8px; border-top: 1px solid rgba(255,255,255,0.3); padding-top: 8px;">${message}</div>`;
        } else {
            finalMessage = message;
        }

        notification.innerHTML = finalMessage;

        notificationContainer.appendChild(notification);
        setTimeout(() => notification.classList.add('show'), 10);

        const closeNotif = () => {
            const notifToClose = document.getElementById(id);
            if (notifToClose) {
                notifToClose.classList.remove('show');
                setTimeout(() => notifToClose.remove(), 400);
            }
        };

        setTimeout(closeNotif, duration);
        notification.addEventListener('click', closeNotif);
        return {
            id,
            close: closeNotif
        };
    };

    const getPersonIndices = (types) => personTypes.map((pt, i) => types.includes(pt) ? i : -1).filter(i => i !== -1);
    const getTimestamp = () => new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    const getScheduleFromUI = () => Array.from(scheduleBody.rows).map(row => Array.from(row.querySelectorAll('select')).map(sel => sel.value));

    // --- CORE LOGIC ---
    const getScheduleViolations = (schedule, ignoreTotalHours = false) => {
        const violations = [];
        let grandTotalHours = 0;

        const managerIndices = getPersonIndices(['M.S.', 'M.S.Y.']);
        const personnelIndices = getPersonIndices(['G.T.', 'PER.']);

        const externalShifts = Object.keys(shiftDefinitions).filter(s => shiftDefinitions[s].type === 'external');

        for (let c = 0; c < daysOfWeek.length; c++) {
            const dailyLeaveCount = schedule.filter((row, r) => activePersonnel[r] && row[c] === 'B').length;
            if (dailyLeaveCount > 1) {
                violations.push(`${daysOfWeek[c]}: Günde en fazla 1 kişi izinli olabilir.`);
            }

            const openingShiftCount = schedule.filter((row, r) =>
                activePersonnel[r] && openingShifts.includes(row[c])
            ).length;

            if (openingShiftCount > 2) {
                violations.push(`${daysOfWeek[c]}: Açılış vardiyasında en fazla 2 kişi olabilir (mevcut: ${openingShiftCount}).`);
            }

            let managerHasEarly = false;
            let managerHasLate = false;
            let personnelHasEarly = false;
            let personnelHasLate = false;

            for (let r = 0; r < personTypes.length; r++) {
                if (!activePersonnel[r]) continue;

                const shift = schedule[r][c];
                const shiftInfo = shiftDefinitions[shift];
                if (!shiftInfo) continue;

                const shiftType = shiftInfo.type;
                const isExternal = shiftType === 'external';

                if (managerIndices.includes(r)) {
                    if (shiftType === 'early' || isExternal) managerHasEarly = true;
                    if (shiftType === 'late' || isExternal) managerHasLate = true;
                }
                if (personnelIndices.includes(r)) {
                    if (shiftType === 'early' || isExternal) personnelHasEarly = true;
                    if (shiftType === 'late' || isExternal) personnelHasLate = true;
                }
            }

            const managersWorking = schedule.some((row, r) => managerIndices.includes(r) && activePersonnel[r] && shiftDefinitions[row[c]] ?.netHours > 0);
            if (managersWorking && (!managerHasEarly || !managerHasLate)) {
                violations.push(`${daysOfWeek[c]}: Yönetici grubunda erken ve geç vardiya dengesi sağlanmalı.`);
            }

            const personnelWorking = schedule.some((row, r) => personnelIndices.includes(r) && activePersonnel[r] && shiftDefinitions[row[c]] ?.netHours > 0);
            if (personnelWorking && (!personnelHasEarly || !personnelHasLate)) {
                violations.push(`${daysOfWeek[c]}: Personel grubunda erken ve geç vardiya dengesi sağlanmalı.`);
            }
        }

        for (let r = 0; r < personTypes.length; r++) {
            if (!activePersonnel[r]) continue;

            const personName = document.querySelector(`#person-row-${r} input`) ?.value || `${personTypes[r]} (${r + 1})`;
            let personHours = 0;
            schedule[r].forEach(shift => personHours += shiftDefinitions[shift] ?.netHours || 0);
            grandTotalHours += personHours;

            if (personHours > 55) violations.push(`${personName}: Haftalık saat limiti (55) aşıldı (${personHours.toFixed(1)}).`);
            if (personHours < 25) violations.push(`${personName}: Haftalık minimum saat (25) doldurulmadı (${personHours.toFixed(1)}).`);

            const leaveCount = schedule[r].filter(s => s === 'B').length;
            if (leaveCount === 0 && !schedule[r].some(s => manualOnlyShifts.includes(s))) violations.push(`${personName}: Haftada 1 gün 'B' izni kullanmalı.`);
            if (leaveCount > 1) violations.push(`${personName}: Haftada 1'den fazla 'B' izni kullanamaz.`);

            const fullDayCount = schedule[r].filter(s => s === 'FULL').length;
            if (fullDayCount > 1) {
                violations.push(`${personName}: Haftada 1'den fazla 'FULL' gün kullanamaz.`);
            }

            for (let c = 0; c < daysOfWeek.length; c++) {
                if (schedule[r][c] === 'B') {
                    if (c > 0 && !earlyShifts.includes(schedule[r][c - 1]) && !leaveTypes.includes(schedule[r][c - 1])) violations.push(`${personName} (${daysOfWeek[c]}): İzin öncesi erken çıkış olmalı.`);
                    if (c < daysOfWeek.length - 1 && !lateShifts.includes(schedule[r][c + 1]) && !leaveTypes.includes(schedule[r][c + 1])) violations.push(`${personName} (${daysOfWeek[c]}): İzin sonrası geç giriş olmalı.`);
                    if (c < daysOfWeek.length - 1 && schedule[r][c + 1] === 'A') violations.push(`${personName} (${daysOfWeek[c+1]}): İzin sonrası 'A' vardiyası gelemez.`);
                }
            }
        }

        return [...new Set(violations)];
    };

    const generateScheduleAttempt = () => {
        let schedule = Array.from({
            length: personTypes.length
        }, () => Array(daysOfWeek.length).fill(null));
        let personHours = Array(personTypes.length).fill(0);
        const activeP = personTypes.map((_, i) => i).filter(r => activePersonnel[r]);

        activeP.forEach(r => {
            for (let c = 0; c < daysOfWeek.length; c++) {
                if (manuallyEditedCells.has(`${r}-${c}`)) {
                    const shift = document.getElementById(`select-${r}-${c}`).value;
                    schedule[r][c] = shift;
                    personHours[r] += shiftDefinitions[shift] ?.netHours || 0;
                }
            }
        });

        const eligibleForA = activeP.filter(r => !unpasifableTypes.includes(personTypes[r]) && !schedule[r][fridayIndex]);
        if (eligibleForA.length > 0) {
            const personIdx = eligibleForA[Math.floor(Math.random() * eligibleForA.length)];
            schedule[personIdx][fridayIndex] = 'A';
            personHours[personIdx] += shiftDefinitions['A'].netHours;
        }

        const dailyLeaveTracker = Array(daysOfWeek.length).fill(false);
        schedule.forEach((row, r) => row.forEach((shift, c) => {
            if (shift === 'B') dailyLeaveTracker[c] = true;
        }));

        for (const r of activeP) {
            if (schedule[r].includes('B')) continue;
            const possibleDays = [0, 1, 2, 3, 5, 6].filter(d => !schedule[r][d] && !dailyLeaveTracker[d]);
            if (possibleDays.length > 0) {
                const dayForB = possibleDays[Math.floor(Math.random() * possibleDays.length)];
                schedule[r][dayForB] = 'B';
                dailyLeaveTracker[dayForB] = true;
            }
        }

        for (let c = 0; c < daysOfWeek.length; c++) {
            const ms_idx = getPersonIndices(['M.S.'])[0],
                msy_idx = getPersonIndices(['M.S.Y.'])[0],
                gt_idx = getPersonIndices(['G.T.'])[0],
                per_indices = getPersonIndices(['PER.']);
            const assignFull = (idx) => {
                if (activePersonnel[idx] && !schedule[idx][c] && schedule[idx].filter(s => s === 'FULL').length === 0) {
                    schedule[idx][c] = 'FULL';
                    personHours[idx] += shiftDefinitions['FULL'].netHours;
                    return true;
                }
                return false;
            };
            if (activePersonnel[ms_idx] && schedule[ms_idx][c] === 'B') assignFull(msy_idx);
            if (activePersonnel[msy_idx] && schedule[msy_idx][c] === 'B') assignFull(ms_idx);
            if (activePersonnel[gt_idx] && schedule[gt_idx][c] === 'B') {
                const availablePer = per_indices.find(r => activePersonnel[r] && !schedule[r][c]);
                if (availablePer) assignFull(availablePer);
            }
            per_indices.forEach(p_idx => {
                if (activePersonnel[p_idx] && schedule[p_idx][c] === 'B') {
                    const availableStaff = [...per_indices.filter(p => p !== p_idx), gt_idx].find(r => activePersonnel[r] && !schedule[r][c]);
                    if (availableStaff) assignFull(availableStaff);
                }
            });
        }

        for (let i = 0; i < 5; i++) {
            activeP.forEach(r => {
                for (let c = 0; c < daysOfWeek.length; c++) {
                    if (schedule[r][c]) continue;

                    let validShifts = [...planningShifts];
                    if (c > 0 && schedule[r][c - 1] === 'B') validShifts = validShifts.filter(s => lateShifts.includes(s) && s !== 'A');
                    if (c < daysOfWeek.length - 1 && schedule[r][c + 1] === 'B') validShifts = validShifts.filter(s => earlyShifts.includes(s));
                    if (c > 0 && lateShifts.includes(schedule[r][c - 1])) validShifts = validShifts.filter(s => !earlyShifts.includes(s));
                    if (specialDays.SevkiyatGunleri ?.includes(daysOfWeek[c])) validShifts = validShifts.filter(s => !earlyShifts.includes(s));
                    validShifts = validShifts.filter(s => (personHours[r] + (shiftDefinitions[s] ?.netHours || 0)) <= 55);

                    if (validShifts.length > 0) {
                        const shift = validShifts[Math.floor(Math.random() * validShifts.length)];
                        schedule[r][c] = shift;
                        personHours[r] += shiftDefinitions[shift].netHours;
                    }
                }
            });
        }

        return schedule;
    };

    const createPlan = () => {
        if (isShuffling) {
            isShuffling = false;
            if (searchTimeoutId) {
                clearTimeout(searchTimeoutId);
                searchTimeoutId = null;
            }
            shuffleButton.disabled = true;
            shuffleButton.classList.add('interrupted-state');
            shuffleButton.querySelector('i').className = 'fas fa-stop';

            setTimeout(() => {
                shuffleButton.classList.remove('interrupted-state');
                shuffleButton.querySelector('i').className = 'fas fa-random';
                shuffleButton.disabled = false;
            }, 2000);

            showNotification('Plan oluşturma işlemi kullanıcı tarafından durduruldu.', 'error', {
                title: 'İşlem İptal Edildi'
            });
            return;
        }

        if (Object.values(activePersonnel).filter(v => v).length === 0) {
            showNotification('Planlama için aktif personel bulunmuyor.', 'error', {
                title: 'Planlama Hatası'
            });
            return;
        }

        isShuffling = true;
        shuffleButton.querySelector('i').className = 'fas fa-spinner fa-spin';

        const initialNotif = showNotification('Kurallara uygun plan aranıyor...', 'info', {
            title: 'Akıllı Arama Başlatıldı'
        });

        let attempts = 0;
        const MAX_ATTEMPTS = 50000;

        function findPlan() {
            if (!isShuffling) {
                initialNotif.close();
                return;
            }

            attempts++;
            const currentSchedule = generateScheduleAttempt();
            const violations = getScheduleViolations(currentSchedule);

            if (violations.length === 0) {
                initialNotif.close();
                applyScheduleToUI(currentSchedule);
                showNotification('Kurallara uygun, başarılı bir plan bulundu!', 'success', {
                    title: 'İşlem Tamamlandı'
                });
                isShuffling = false;
                shuffleButton.disabled = false;
                shuffleButton.querySelector('i').className = 'fas fa-random';
                if (searchTimeoutId) clearTimeout(searchTimeoutId);
                return;
            }

            if (attempts < MAX_ATTEMPTS) {
                searchTimeoutId = setTimeout(findPlan, 0);
            } else {
                initialNotif.close();
                showNotification(`Maksimum deneme sayısına (${MAX_ATTEMPTS}) ulaşıldı ancak kurallara uygun bir plan bulunamadı. Lütfen kilitli hücreleri veya özel gün ayarlarını kontrol edip tekrar deneyin.`, 'error', {
                    title: 'Arama Başarısız Oldu'
                });
                isShuffling = false;
                shuffleButton.disabled = false;
                shuffleButton.querySelector('i').className = 'fas fa-random';
                if (searchTimeoutId) clearTimeout(searchTimeoutId);
            }
        }

        findPlan();
    };


    const applyScheduleToUI = (schedule) => {
        schedule.forEach((personSchedule, r) => {
            if (activePersonnel[r]) {
                personSchedule.forEach((shift, c) => {
                    const select = document.getElementById(`select-${r}-${c}`);
                    if (select) select.value = shift || 'M';
                });
            }
        });
        updateTotalsAndStats();
    };

    const updateTotalsAndStats = () => {
        let grandTotalHours = 0;
        const activeCount = Object.values(activePersonnel).filter(v => v).length;

        Array.from(scheduleBody.rows).forEach((row, r) => {
            let rowTotalHours = 0;
            if (activePersonnel[r]) {
                row.querySelectorAll('select').forEach(sel => rowTotalHours += shiftDefinitions[sel.value] ?.netHours || 0);
            }
            const totalHoursCell = row.cells[row.cells.length - 1];
            if (totalHoursCell) {
                totalHoursCell.textContent = rowTotalHours.toFixed(1);
            }
            grandTotalHours += rowTotalHours;
        });

        document.getElementById('total-hours').textContent = grandTotalHours.toFixed(1);
        document.getElementById('active-personnel').textContent = activeCount;
        document.getElementById('locked-cells').textContent = manuallyEditedCells.size;

        const hiddenRowCount = document.querySelectorAll('.toggleable-row.hidden-row').length;
        addRowBtn.style.display = hiddenRowCount > 0 ? 'flex' : 'none';
    };

    // DÜZELTME: İndirme fonksiyonu tamamen elden geçirildi.
    // DÜZELTME: İndirme fonksiyonu
    const downloadPlanAsPNG = () => {
        const currentSchedule = getScheduleFromUI();
        const violations = getScheduleViolations(currentSchedule);
        if (violations.length > 0) {
            const errorList = '<ul>' + violations.map(v => `<li>${v}</li>`).join('') + '</ul>';
            showNotification(errorList, 'error', {
                isHtml: true,
                title: `İndirme Başarısız (${violations.length} ihlal)`
            });
            return;
        }

        showNotification('Plan görüntüsü oluşturuluyor, lütfen bekleyin. Bu işlem tablonun boyutuna göre biraz zaman alabilir.', 'info', {
            title: 'İndirme Başlatıldı'
        });

        const originalTable = document.getElementById('schedule-table');
        // DÜZELTME: Kenar boşlukları için güvenlik payı artırıldı.
        const fullWidth = originalTable.scrollWidth + 60; 

        const captureWrapper = document.createElement('div');
        document.body.appendChild(captureWrapper);

        Object.assign(captureWrapper.style, {
            position: 'absolute',
            top: '0',
            left: '-9999px',
            width: `${fullWidth}px`,
            backgroundColor: '#eef1f5',
            padding: '20px'
        });

        const appContainerClone = appContainer.cloneNode(true);
        const specialDaysDrawerClone = document.getElementById('special-days-drawer').cloneNode(true);

        const clonedTable = appContainerClone.querySelector('#schedule-table');
        if (clonedTable) {
            clonedTable.classList.remove('sidebar-collapsed');
        }

        appContainerClone.style.width = `${fullWidth}px`;
        const clonedMainContent = appContainerClone.querySelector('.main-content');
        if (clonedMainContent) clonedMainContent.style.overflow = 'visible';

        const clonedTableContainer = appContainerClone.querySelector('.table-container');
        if (clonedTableContainer) clonedTableContainer.style.overflow = 'visible';

        const originalSelects = appContainer.querySelectorAll('select');
        const clonedSelects = appContainerClone.querySelectorAll('select');
        originalSelects.forEach((s, i) => { if (clonedSelects[i]) clonedSelects[i].value = s.value; });

        const originalInputs = appContainer.querySelectorAll('input');
        const clonedInputs = appContainerClone.querySelectorAll('input');
        originalInputs.forEach((inp, i) => { if (clonedInputs[i]) clonedInputs[i].value = inp.value; });

        const originalCheckboxes = document.querySelectorAll('#special-days-drawer input[type="checkbox"]');
        const clonedCheckboxes = specialDaysDrawerClone.querySelectorAll('input[type="checkbox"]');
        originalCheckboxes.forEach((cb, i) => { if (clonedCheckboxes[i]) clonedCheckboxes[i].checked = cb.checked; });


        captureWrapper.appendChild(appContainerClone);
        captureWrapper.appendChild(specialDaysDrawerClone);

        specialDaysDrawerClone.classList.add('open');
        Object.assign(specialDaysDrawerClone.style, {
            position: 'relative',
            transform: 'none',
            marginTop: '20px'
        });

        html2canvas(captureWrapper, {
            width: fullWidth,
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: null
        }).then(canvas => {
            const scheduleTitle = document.getElementById('schedule-title-input').value.replace(/ /g, '_');
            const fileName = `${scheduleTitle}_${getTimestamp()}.png`;
            const link = document.createElement('a');
            link.download = fileName;
            link.href = canvas.toDataURL('image/png');
            link.click();
            showNotification('Plan başarıyla indirildi.', 'success', {
                title: "İndirme Tamamlandı"
            });
        }).catch(err => {
            console.error('html2canvas hatası:', err);
            showNotification('Plan görüntüsü oluşturulamadı. Teknik bir sorun oluştu.', 'error', {
                title: 'İndirme Hatası'
            });
        }).finally(() => {
            document.body.removeChild(captureWrapper);
        });
    };

    const initializeUI = () => {
        scheduleBody.innerHTML = '';
        personTypes.forEach((type, r) => {
            const isToggleable = toggleableRowIndices.includes(r);
            activePersonnel[r] = !isToggleable;

            const row = scheduleBody.insertRow();
            row.id = `person-row-${r}`;
            if (isToggleable) row.classList.add('toggleable-row', 'hidden-row');

            const typeCell = row.insertCell();
            typeCell.textContent = type;
            typeCell.className = 'person-type sidebar-column';
            typeCell.addEventListener('click', () => {
                if (unpasifableTypes.includes(type)) return showNotification(`${type} personeli pasif yapılamaz.`, 'error');
                if (isToggleable) {
                    row.classList.add('hidden-row');
                    activePersonnel[r] = false;
                    row.querySelectorAll('select').forEach(sel => sel.value = 'M');
                    updateTotalsAndStats();
                }
            });

            const nameCell = row.insertCell();
            nameCell.className = 'person-name sidebar-column';
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.placeholder = 'Ad Soyad';
            nameInput.maxLength = 25;
            nameCell.appendChild(nameInput);

            daysOfWeek.forEach((_, c) => {
                const dayCell = row.insertCell();
                const select = document.createElement('select');
                select.id = `select-${r}-${c}`;
                Object.keys(shiftDefinitions).forEach(slot => select.add(new Option(slot, slot)));
                select.value = 'M';
                dayCell.appendChild(select);
                select.addEventListener('change', () => {
                    if (!isLocked) preLockEdits.add(`${r}-${c}`);
                    else {
                        manuallyEditedCells.add(`${r}-${c}`);
                        select.parentElement.classList.add('manual-lock');
                        document.getElementById('locked-cells').textContent = manuallyEditedCells.size;
                    }
                    updateTotalsAndStats();
                });
            });
            row.insertCell().className = 'total-hours';
        });

        const specialDayGrid = document.getElementById('special-day-grid');
        specialDayGrid.innerHTML = '';
        let headerHtml = `<div class="day-header">Vardiya Türü</div>` + daysOfWeek.map(day => `<div class="day-header">${day}</div>`).join('');
        specialDayGrid.innerHTML += headerHtml;

        specialDayTypes.forEach(eventType => {
            const eventKey = eventType.replace(/ /g, '');
            let rowHtml = `<div class="event-label">${eventType}</div>`;
            rowHtml += daysOfWeek.map(day => `<div class="day-checkbox"><input type="checkbox" data-event="${eventKey}" data-day="${day}"></div>`).join('');
            specialDayGrid.innerHTML += rowHtml;
        });

        document.querySelectorAll('#special-day-grid input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const {
                    event,
                    day
                } = e.target.dataset;
                if (!specialDays[event]) specialDays[event] = [];
                if (e.target.checked) {
                    if (!specialDays[event].includes(day)) specialDays[event].push(day);
                } else {
                    specialDays[event] = specialDays[event].filter(d => d !== day);
                }
            });
        });


        addRowBtn.addEventListener('click', () => {
            const firstHiddenRow = document.querySelector('.toggleable-row.hidden-row');
            if (firstHiddenRow) {
                const rowIndex = parseInt(firstHiddenRow.id.split('-')[2]);
                firstHiddenRow.classList.remove('hidden-row');
                activePersonnel[rowIndex] = true;
                updateTotalsAndStats();
            }
        });

        shuffleButton.addEventListener('click', createPlan);
        downloadButton.addEventListener('click', downloadPlanAsPNG);

        lockButton.addEventListener('click', () => {
            isLocked = !isLocked;
            lockButton.classList.toggle('locked', isLocked);
            lockButton.querySelector('i').className = isLocked ? 'fas fa-lock' : 'fas fa-lock-open';

            document.querySelectorAll('.manual-lock').forEach(cell => cell.classList.remove('manual-lock'));

            if (isLocked) {
                manuallyEditedCells = new Set([...manuallyEditedCells, ...preLockEdits]);
                preLockEdits.clear();
                manuallyEditedCells.forEach(cellId => {
                    const [r, c] = cellId.split('-');
                    const cell = document.getElementById(`select-${r}-${c}`);
                    if (cell) cell.parentElement.classList.add('manual-lock');
                });
                showNotification(`${manuallyEditedCells.size} hücre kilitlendi. Değişiklikleriniz artık plan oluştururken dikkate alınacak.`, 'info', {
                    title: 'Hücreler Kilitlendi'
                });
            } else {
                manuallyEditedCells.clear();
                preLockEdits.clear();
                showNotification('Tüm hücre kilitleri kaldırıldı.', 'info', {
                    title: 'Kilitler Açıldı'
                });
            }
            updateTotalsAndStats();
        });

        const toggleDrawer = () => {
            const isOpen = drawer.classList.toggle('open');
            drawerToggleButton.classList.toggle('open', isOpen);
            overlay.classList.toggle('show', isOpen);
        };

        drawerToggleButton.addEventListener('click', toggleDrawer);
        overlay.addEventListener('click', () => {
            if (drawer.classList.contains('open')) {
                toggleDrawer();
            }
        });

        const toggleSidebarBtn = document.getElementById('sidebar-toggle-btn');
        const scheduleTable = document.getElementById('schedule-table');

        if (toggleSidebarBtn && scheduleTable) {
            toggleSidebarBtn.addEventListener('click', () => {
                const isCollapsed = scheduleTable.classList.toggle('sidebar-collapsed');
                const icon = toggleSidebarBtn.querySelector('i');
                icon.className = isCollapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
                toggleSidebarBtn.title = isCollapsed ? 'Menüyü Göster' : 'Menüyü Gizle';
            });
        }

        updateTotalsAndStats();
    };

    initializeUI();
});