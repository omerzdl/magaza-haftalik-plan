document.addEventListener('DOMContentLoaded', () => {
    const scheduleBody = document.getElementById('schedule-body');
    const specialRowsBody = document.getElementById('special-rows-body');
    const shuffleButton = document.getElementById('shuffle-button');
    const downloadButton = document.getElementById('download-button');
    const notification = document.getElementById('notification');
    const table = document.getElementById('schedule-table');

    // Max 6 persons
    const personTypes = ['M.S.', 'M.S.Y.', 'G.T.', 'PER.', 'PER.', 'PER.'];
    const daysOfWeek = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
    const timeSlots = [
        '08.45-13.15', // 4.5 hours
        '08.45-17.45', // 9 hours
        '08.45-19.45', // 11 hours
        '12.15-21.15', // 9 hours
        '13.15-21.15', // 8 hours
        '14.45-21.15', // 6.5 hours
        '15.45-21.15', // 5.5 hours
        'B',           // İzinli (0 hours)
        '='            // Full Day (11 hours) - Use '=' as text representation
    ].sort((a, b) => {
        // Custom sort to put 'B' and '=' at the end
        if (a === 'B') return 1;
        if (b === 'B') return -1;
        if (a === '=') return 1;
        if (b === '=') -1; 

        // Handle string comparison for time slots
        const [startA] = a.split('-');
        const [startB] = b.split('-');
        if (startA.includes('.') && startB.includes('.')) {
            return startA.localeCompare(startB);
        }
        return 0; // Don't change order if not time slots
    });

    // Time slots that represent actual working hours
    const workingTimeSlots = timeSlots.filter(slot => slot !== 'B' && slot !== '=');
    const specialRowNames = ['Toplanti Gunleri', 'Sevkiyat Gunleri', 'Tat-Num Testi Gunleri', 'El Ilani Dagitim Gunleri'];

    // Group definitions for the new rule
    const managerGroupIndices = [0, 1]; // M.S., M.S.Y. (indices in personTypes)
    const personnelGroupIndices = [2, 3, 4, 5]; // G.T., PER., PER., PER.

    const calculateDuration = (timeSlot) => {
        if (timeSlot === 'B' || !timeSlot) return 0;
        if (timeSlot === '=') return 11; // Full day is 11 hours

        const [start, end] = timeSlot.split('-');
        const [startH, startM] = start.split('.').map(Number);
        const [endH, endM] = end.split('.').map(Number);

        const startDate = new Date(0, 0, 0, startH, startM);
        const endDate = new Date(0, 0, 0, endH, endM);

        if (endDate < startDate) {
            endDate.setDate(endDate.getDate() + 1);
        }

        const diffMs = endDate - startDate;
        const diffHours = diffMs / (1000 * 60 * 60);
        return diffHours;
    };

    // Helper to convert HH.MM to minutes for comparison
    const timeToMinutes = (timeStr) => {
        const [h, m] = timeStr.split('.').map(Number);
        return h * 60 + m;
    };

    // Checks if a given time slot covers a specific minute range
    const doesSlotCoverTime = (slot, checkStartMin, checkEndMin) => {
        if (slot === 'B' || slot === '=') return false; // Leave and full day don't count for coverage

        const [startStr, endStr] = slot.split('-');
        let slotStartMin = timeToMinutes(startStr);
        let slotEndMin = timeToMinutes(endStr);

        // Handle overnight shifts for comparison purposes (e.g., 20:00-04:00)
        if (slotEndMin < slotStartMin) {
            slotEndMin += 24 * 60; // Add 24 hours in minutes
        }

        // Adjust check times if they wrap around midnight for comparison
        let effectiveCheckStartMin = checkStartMin;
        let effectiveCheckEndMin = checkEndMin;
        if (effectiveCheckEndMin < effectiveCheckStartMin) {
            effectiveCheckEndMin += 24 * 60;
        }

        // A slot covers the check interval if there is any overlap
        // (slotStart < effectiveCheckEnd && slotEnd > effectiveCheckStart)
        return (slotStartMin < effectiveCheckEndMin && slotEndMin > effectiveCheckStartMin);
    };

    const createScheduleRow = (personType, index) => {
        const row = document.createElement('tr');
        row.dataset.rowIndex = index;

        const typeCell = document.createElement('td');
        typeCell.textContent = personType;
        typeCell.classList.add('person-type-cell');
        typeCell.addEventListener('click', () => toggleRowActive(row));
        row.appendChild(typeCell);

        const nameCell = document.createElement('td');
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.classList.add('editable-name');
        nameInput.maxLength = 15;
        nameInput.placeholder = 'Adı Soyadı';
        nameInput.id = `employee-name-${index}`;
        nameInput.addEventListener('input', () => saveSchedule());
        nameCell.appendChild(nameInput);
        row.appendChild(nameCell);

        daysOfWeek.forEach(day => {
            const cell = document.createElement('td');
            cell.id = `schedule-cell-${index}-${day}`;
            row.appendChild(cell);
        });

        const totalHoursCell = document.createElement('td');
        totalHoursCell.classList.add('total-hours-cell');
        totalHoursCell.id = `total-hours-${index}`;
        row.appendChild(totalHoursCell);

        return row;
    };

    const setupSpecialRowCheckboxes = (rowElement) => {
        daysOfWeek.forEach((day, dayIdx) => {
            const cell = rowElement.querySelector(`td:nth-child(${dayIdx + 3})`); // dayIdx + 3 because first two TDs are merged
            if (cell) {
                let checkbox = cell.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.disabled = false;
                    checkbox.addEventListener('change', saveSchedule);
                }
            }
        });
    };

    const initializeSchedule = () => {
        // Clear existing rows before (re)creating
        scheduleBody.innerHTML = '';
        personTypes.forEach((type, index) => {
            scheduleBody.appendChild(createScheduleRow(type, index));
        });

        // Default active employees: MS, MSY, GT
        const defaultActiveIndices = [0, 1, 2];
        defaultActiveIndices.forEach(index => {
            const row = document.querySelector(`[data-row-index="${index}"]`);
            if (row && !row.classList.contains('active')) {
                // Ensure this toggle activates the dropdowns if the row was just created
                toggleRowActive(row);
            }
        });

        const specialRowElements = specialRowsBody.querySelectorAll('tr');
        specialRowNames.forEach((name, idx) => {
            if (specialRowElements[idx]) {
                setupSpecialRowCheckboxes(specialRowElements[idx]);
            }
        });
        
        // This save will capture the initial state with MS, MSY, GT active
        saveSchedule();
    };

    const toggleRowActive = (row) => {
        const index = row.dataset.rowIndex;
        const isActiveBeforeToggle = row.classList.contains('active');

        row.classList.toggle('active');
        const typeCell = row.querySelector('.person-type-cell');
        typeCell.classList.toggle('active');

        const isActiveAfterToggle = row.classList.contains('active');

        daysOfWeek.forEach(day => {
            const cell = document.getElementById(`schedule-cell-${index}-${day}`);
            cell.innerHTML = ''; // Clear existing content

            if (isActiveAfterToggle) {
                const select = document.createElement('select');
                select.id = `schedule-select-${index}-${day}`;
                select.name = `schedule-select-${index}-${day}`;

                timeSlots.forEach(slot => {
                    const option = document.createElement('option');
                    option.value = slot;
                    option.textContent = slot;
                    select.appendChild(option);
                });

                select.addEventListener('change', () => {
                    updateTotalHoursForEmployee(index);
                    saveSchedule();
                });
                cell.appendChild(select);
            }
        });
        updateTotalHoursForEmployee(index);
        saveSchedule(); // Save state after each toggle
    };

    // --- NEW VALIDATION LOGIC ---
    const validateSchedule = () => {
        const errors = [];
        const activeEmployeesData = [];

        // 1. Collect active employee data
        personTypes.forEach((type, index) => {
            const row = document.querySelector(`[data-row-index="${index}"]`);
            if (row && row.classList.contains('active')) {
                const employeeName = document.getElementById(`employee-name-${index}`).value || `${type} ${index + 1}`;
                const dailySchedule = {};
                daysOfWeek.forEach(day => {
                    const selectElement = document.getElementById(`schedule-select-${index}-${day}`);
                    if (selectElement) {
                        dailySchedule[day] = selectElement.value;
                    }
                });
                activeEmployeesData.push({ name: employeeName, index: index, type: type, dailySchedule: dailySchedule });
            }
        });

        // Minimum 3 active employees check
        if (activeEmployeesData.length < 3) {
            errors.push("Mağazada en az 3 aktif çalışan (M.S., M.S.Y., G.T. varsayılan) olmalıdır.");
            return errors;
        }

        // Separate active employees into groups
        const activeManagers = activeEmployeesData.filter(emp => managerGroupIndices.includes(emp.index));
        const activePersonnel = activeEmployeesData.filter(emp => personnelGroupIndices.includes(emp.index));

        // 2. Validate per-person rules (Leave Day, Full Day, Total Hours)
        activeEmployeesData.forEach(employee => {
            let leaveDaysCount = 0;
            let fullDaysCount = 0;
            let totalHours = 0;

            daysOfWeek.forEach(day => {
                const slot = employee.dailySchedule[day];
                if (slot === 'B') leaveDaysCount++;
                if (slot === '=') fullDaysCount++;
                totalHours += calculateDuration(slot);
            });

            if (leaveDaysCount !== 1) {
                errors.push(`${employee.name}: Haftada tam olarak 1 izin günü ('B') olmalıdır. Şu an ${leaveDaysCount} var.`);
            }
            if (fullDaysCount !== 1) {
                errors.push(`${employee.name}: Haftada tam olarak 1 tam gün ('=') olmalıdır. Şu an ${fullDaysCount} var.`);
            }

            // Updated total hours validation: 45-55 hours
            if (totalHours < 45 || totalHours > 55) {
                errors.push(`${employee.name}: Haftalık toplam çalışma süresi 45-55 saat arasında olmalıdır. Şu an ${totalHours.toFixed(2)} saat.`);
            }
        });

        // 3. Validate Group-Based 'B' and '=' Rule
        daysOfWeek.forEach(day => {
            // Manager Group (M.S., M.S.Y.)
            const ms = activeManagers.find(m => m.type === 'M.S.');
            const msy = activeManagers.find(m => m.type === 'M.S.Y.');

            if (ms && msy) { // Both managers are active
                const msSlot = ms.dailySchedule[day];
                const msySlot = msy.dailySchedule[day];

                if (msSlot === 'B' && msySlot !== '=') {
                    errors.push(`Yönetici Grubu (${day}): M.S. izinliyse (B), M.S.Y. tam gün (=) olmalıdır. (M.S.Y. şu an: ${msySlot || 'Boş'})`);
                }
                if (msySlot === 'B' && msSlot !== '=') {
                    errors.push(`Yönetici Grubu (${day}): M.S.Y. izinliyse (B), M.S. tam gün (=) olmalıdır. (M.S. şu an: ${msSlot || 'Boş'})`);
                }
                if (msSlot === 'B' && msySlot === 'B') {
                    errors.push(`Yönetici Grubu (${day}): M.S. ve M.S.Y. aynı anda izinli (B) olamaz.`);
                }
                if (msSlot === '=' && msySlot === '=') {
                     errors.push(`Yönetici Grubu (${day}): M.S. ve M.S.Y. aynı anda tam gün (=) olamaz.`);
                }
            } else if (ms && ms.dailySchedule[day] === 'B') {
                // If only MS is active and is B, there's no MSY to cover. This is a potential issue.
                // The rule implies that if one manager is B, the *other* must be =.
                // So if only one manager is active, the rule about them covering each other doesn't apply.
                // We only apply this specific rule if both are active.
            } else if (msy && msy.dailySchedule[day] === 'B') {
                // Same for MSY
            }


            // Personnel Group (G.T., PER., PER., PER.)
            const personnelBCount = activePersonnel.filter(emp => emp.dailySchedule[day] === 'B').length;
            const personnelFullCount = activePersonnel.filter(emp => emp.dailySchedule[day] === '=').length;

            if (personnelBCount > 0 && personnelFullCount === 0) {
                 errors.push(`Personel Grubu (${day}): Eğer bir personel izinliyse (B) başka bir personel tam gün (=) olmalıdır. Şu an ${personnelBCount} izinli ve 0 tam gün var.`);
            }
            if (personnelBCount > 1) {
                errors.push(`Personel Grubu (${day}): Aynı anda birden fazla personel izinli (B) olamaz.`);
            }
        });

        // 4. Validate Store Coverage (8:45-21:15, at least 2 people)
        const storeOpen = timeToMinutes('08.45');
        const storeClose = timeToMinutes('21.15');

        const checkIntervals = [];
        for (let m = storeOpen; m < storeClose; m += 15) { // Check every 15 minutes up to (but not including) close
            checkIntervals.push({ start: m, end: m + 15 }); // Check a 15-minute interval
        }

        daysOfWeek.forEach(day => {
            checkIntervals.forEach(interval => {
                let staffCount = 0;
                activeEmployeesData.forEach(employee => {
                    const slot = employee.dailySchedule[day];
                    if (doesSlotCoverTime(slot, interval.start, interval.end)) {
                        staffCount++;
                    }
                });
                if (staffCount < 2) {
                    const checkStartTime = `${Math.floor(interval.start / 60).toString().padStart(2, '0')}.${(interval.start % 60).toString().padStart(2, '0')}`;
                    const checkEndTime = `${Math.floor(interval.end / 60).toString().padStart(2, '0')}.${(interval.end % 60).toString().padStart(2, '0')}`;
                    const errorMsg = `${day} günü ${checkStartTime} - ${checkEndTime} aralığında mağazada en az 2 kişi bulunmalıdır. Şu an ${staffCount} kişi var.`;
                    // Add error only if it's new to avoid redundant messages for contiguous violations
                    if (!errors.every(e => e !== errorMsg)) { // Check if this exact error message already exists
                        errors.push(errorMsg);
                    }
                }
            });
        });

        return errors;
    };


    const shuffleSchedule = () => {
        const activeEmployeeIndices = [];
        personTypes.forEach((_, index) => {
            const row = document.querySelector(`[data-row-index="${index}"]`);
            if (row && row.classList.contains('active')) {
                activeEmployeeIndices.push(index);
            }
        });

        if (activeEmployeeIndices.length < 3) {
            showNotification('Planı karıştırmak için en az 3 çalışan (M.S., M.S.Y., G.T. varsayılan olarak seçili) aktif olmalıdır.', 'error');
            return;
        }
        
        const maxShuffleAttempts = 3000; // Increased attempts further
        let validScheduleFound = false;
        let bestErrors = []; // To store errors of the "least bad" schedule

        for (let attempt = 0; attempt < maxShuffleAttempts; attempt++) {
            let currentSchedules = {}; // Store schedules for this attempt

            // Initialize all schedules for active employees with null
            activeEmployeeIndices.forEach(empIndex => {
                currentSchedules[empIndex] = {};
                daysOfWeek.forEach(day => {
                    currentSchedules[empIndex][day] = null; // Initialize with null
                });
            });

            // Step 1: Assign one 'B' and one '=' per employee, considering group rules
            
            // Collect available days for 'B' and '='
            const availableDaysForB = [...daysOfWeek].filter(day => day !== 'Cuma'); // No 'B' on Friday
            const availableDaysForFull = [...daysOfWeek];

            // Manager Group (M.S., M.S.Y.) - indices 0 and 1
            const msIndex = activeEmployeeIndices.find(idx => personTypes[idx] === 'M.S.');
            const msyIndex = activeEmployeeIndices.find(idx => personTypes[idx] === 'M.S.Y.');

            if (msIndex !== undefined && msyIndex !== undefined) {
                // Determine a 'B' day for MS (not Friday)
                let msBDay = availableDaysForB[Math.floor(Math.random() * availableDaysForB.length)];
                currentSchedules[msIndex][msBDay] = 'B';
                // MSY must be '=' on MS's 'B' day
                currentSchedules[msyIndex][msBDay] = '=';

                // Determine a 'B' day for MSY (not Friday, and not MS's B day)
                let availableDaysForMsyB = availableDaysForB.filter(day => day !== msBDay);
                if (availableDaysForMsyB.length > 0) {
                    let msyBDay = availableDaysForMsyB[Math.floor(Math.random() * availableDaysForMsyB.length)];
                    currentSchedules[msyIndex][msyBDay] = 'B';
                    // MS must be '=' on MSY's 'B' day
                    currentSchedules[msIndex][msyBDay] = '=';
                } else {
                    // Fallback if no unique day for MSY's B.
                    // This situation is rare and will likely lead to a validation error, but we proceed.
                    // It means MS and MSY might share the same 'B' day, or MSY might not get a 'B' day if only one non-Friday day is available.
                }
            } else if (msIndex !== undefined) { // Only MS active
                // Assign B and = for MS if only MS is active
                let msBDay = availableDaysForB[Math.floor(Math.random() * availableDaysForB.length)];
                currentSchedules[msIndex][msBDay] = 'B';
                let tempAvailableDaysForFull = [...availableDaysForFull].filter(day => day !== msBDay);
                let msFullDay = tempAvailableDaysForFull[Math.floor(Math.random() * tempAvailableDaysForFull.length)];
                currentSchedules[msIndex][msFullDay] = '=';
            } else if (msyIndex !== undefined) { // Only MSY active
                // Assign B and = for MSY if only MSY is active
                let msyBDay = availableDaysForB[Math.floor(Math.random() * availableDaysForB.length)];
                currentSchedules[msyIndex][msyBDay] = 'B';
                let tempAvailableDaysForFull = [...availableDaysForFull].filter(day => day !== msyBDay);
                let msyFullDay = tempAvailableDaysForFull[Math.floor(Math.random() * tempAvailableDaysForFull.length)];
                currentSchedules[msyIndex][msyFullDay] = '=';
            }
            
            // Personnel Group (G.T., PER., PER., PER.)
            const personnelActiveIndices = activeEmployeeIndices.filter(idx => personnelGroupIndices.includes(idx));
            
            personnelActiveIndices.forEach(empIndex => {
                // Ensure 'B' day is not Friday and not already assigned for this person
                let tempAvailableDaysForB = [...availableDaysForB].filter(day => currentSchedules[empIndex][day] === null);
                if (tempAvailableDaysForB.length > 0) {
                    let personBDay = tempAvailableDaysForB[Math.floor(Math.random() * tempAvailableDaysForB.length)];
                    currentSchedules[empIndex][personBDay] = 'B';
                }

                // Ensure '=' day is different from 'B' day and not already assigned
                let tempAvailableDaysForFull = [...availableDaysForFull].filter(day => currentSchedules[empIndex][day] === null);
                
                // Remove the assigned 'B' day from available full days to ensure they are different
                const assignedBDay = daysOfWeek.find(day => currentSchedules[empIndex][day] === 'B');
                if (assignedBDay) {
                    tempAvailableDaysForFull = tempAvailableDaysForFull.filter(day => day !== assignedBDay);
                }

                if (tempAvailableDaysForFull.length > 0) {
                    let personFullDay = tempAvailableDaysForFull[Math.floor(Math.random() * tempAvailableDaysForFull.length)];
                    currentSchedules[empIndex][personFullDay] = '=';
                }
            });


            // Step 3: Fill remaining empty slots with random working hours
            activeEmployeeIndices.forEach(empIndex => {
                daysOfWeek.forEach(day => {
                    if (currentSchedules[empIndex][day] === null) {
                        const randomIndex = Math.floor(Math.random() * workingTimeSlots.length);
                        currentSchedules[empIndex][day] = workingTimeSlots[randomIndex];
                    }
                });
            });

            // Apply this tentative schedule to the actual dropdowns for validation
            activeEmployeeIndices.forEach(empIndex => {
                daysOfWeek.forEach(day => {
                    const selectElement = document.getElementById(`schedule-select-${empIndex}-${day}`);
                    if (selectElement) {
                        selectElement.value = currentSchedules[empIndex][day];
                    }
                });
                updateTotalHoursForEmployee(empIndex); // Update hours for validation
            });

            const validationErrors = validateSchedule();
            if (validationErrors.length === 0) {
                validScheduleFound = true;
                break; // Found a valid schedule, exit loop
            } else if (bestErrors.length === 0 || validationErrors.length < bestErrors.length) {
                bestErrors = validationErrors; // Keep track of the schedule with fewest errors
            }
        }

        if (validScheduleFound) {
            saveSchedule();
            showNotification('Plan başarıyla karıştırıldı ve tüm kurallar karşılandı!', 'success');
        } else {
            // Display the best (fewest) errors found
            showNotification(`Belirtilen kurallara uygun bir plan ${maxShuffleAttempts} denemede bulunamadı. Lütfen manuel olarak ayarlamayı deneyin veya koşulları gözden geçirin.`, 'error', true, bestErrors);
        }
    };

    const saveSchedule = () => {
        const scheduleData = {
            employees: [],
            specialRows: {}
        };

        personTypes.forEach((type, index) => {
            const row = document.querySelector(`[data-row-index="${index}"]`);
            if (row) { // Ensure the row element exists
                const isActive = row.classList.contains('active');
                const nameInput = document.getElementById(`employee-name-${index}`);
                const employeeName = nameInput ? nameInput.value : '';

                const employeeSchedule = {
                    personType: type,
                    name: employeeName,
                    active: isActive,
                    dailySchedule: {}
                };

                // Only save daily schedule if the row is active to avoid null/undefined values for inactive rows
                if (isActive) {
                    daysOfWeek.forEach(day => {
                        const selectElement = document.getElementById(`schedule-select-${index}-${day}`);
                        if (selectElement) {
                            employeeSchedule.dailySchedule[day] = selectElement.value;
                        }
                    });
                }
                scheduleData.employees.push(employeeSchedule);
            }
        });

        const specialRowElements = specialRowsBody.querySelectorAll('tr');
        specialRowNames.forEach((name, idx) => {
            scheduleData.specialRows[name] = {};
            if (specialRowElements[idx]) {
                daysOfWeek.forEach((day, dayIdx) => {
                    const checkbox = specialRowElements[idx].querySelector(`td:nth-child(${dayIdx + 3}) input[type="checkbox"]`);
                    if (checkbox) {
                        scheduleData.specialRows[name][day] = checkbox.checked;
                    }
                });
            }
        });

        localStorage.setItem('bimWeeklySchedule', JSON.stringify(scheduleData));
    };

    const loadSchedule = () => {
        const savedData = localStorage.getItem('bimWeeklySchedule');
        
        // Always initialize all rows first, regardless of saved data
        initializeSchedule(); // This will create all rows and set default active ones (MS, MSY, GT)

        if (savedData) {
            const scheduleData = JSON.parse(savedData);

            // Temporarily disable saveSchedule to prevent multiple saves during load
            const originalSaveSchedule = saveSchedule;
            saveSchedule = () => {}; 

            scheduleData.employees.forEach((employee, index) => {
                if (index < personTypes.length) { // Ensure index is within current personTypes bounds
                    const row = document.querySelector(`[data-row-index="${index}"]`);
                    if (row) {
                        const nameInput = document.getElementById(`employee-name-${index}`);
                        if (nameInput) {
                            nameInput.value = employee.name;
                        }

                        // Handle active state
                        const isActiveInSavedData = employee.active;
                        const isCurrentlyActive = row.classList.contains('active');

                        if (isActiveInSavedData && !isCurrentlyActive) {
                            toggleRowActive(row); // Activate row if it should be active but isn't
                        } else if (!isActiveInSavedData && isCurrentlyActive) {
                            toggleRowActive(row); // Deactivate row if it shouldn't be active but is
                        }
                        // If it's already in the correct state, toggleRowActive will do nothing or re-initialize.
                        // Ensure dropdowns are correctly populated for active rows
                        if (isActiveInSavedData) {
                            daysOfWeek.forEach(day => {
                                const selectElement = document.getElementById(`schedule-select-${index}-${day}`);
                                if (selectElement && employee.dailySchedule && employee.dailySchedule[day]) {
                                    if (Array.from(selectElement.options).some(opt => opt.value === employee.dailySchedule[day])) {
                                        selectElement.value = employee.dailySchedule[day];
                                    } else {
                                        selectElement.value = workingTimeSlots[0]; // Fallback if saved value is invalid
                                    }
                                }
                            });
                        }
                        updateTotalHoursForEmployee(index);
                    }
                }
            });

            if (scheduleData.specialRows) {
                const specialRowElements = specialRowsBody.querySelectorAll('tr');
                specialRowNames.forEach((name, idx) => {
                    const row = specialRowElements[idx];
                    if (row) {
                        daysOfWeek.forEach((day, dayIdx) => {
                            const checkbox = row.querySelector(`td:nth-child(${dayIdx + 3}) input[type="checkbox"]`);
                            if (checkbox && scheduleData.specialRows[name] && typeof scheduleData.specialRows[name][day] !== 'undefined') {
                                checkbox.checked = scheduleData.specialRows[name][day];
                            }
                        });
                    }
                });
            }
            saveSchedule = originalSaveSchedule; // Restore saveSchedule
            showNotification('Kaydedilmiş plan yüklendi!', 'success');
        } else {
            // If no saved data, initializeSchedule already handled setting up defaults.
            // No need to show notification here if it's the very first load.
        }
        // Always trigger a save after load to ensure current state (including defaults if no saved data) is recorded.
        saveSchedule();
    };

    const updateTotalHoursForEmployee = (employeeIndex) => {
        const row = document.querySelector(`[data-row-index="${employeeIndex}"]`);
        if (!row || !row.classList.contains('active')) {
            const totalHoursCell = document.getElementById(`total-hours-${employeeIndex}`);
            if (totalHoursCell) totalHoursCell.textContent = ''; // Clear if not active
            return;
        }

        let totalHours = 0;
        daysOfWeek.forEach(day => {
            const selectElement = document.getElementById(`schedule-select-${employeeIndex}-${day}`);
            if (selectElement) {
                totalHours += calculateDuration(selectElement.value);
            }
        });
        const totalHoursCell = document.getElementById(`total-hours-${employeeIndex}`);
        if (totalHoursCell) {
            totalHoursCell.textContent = totalHours.toFixed(2);
        }
    };


    const downloadTableAsPng = async () => {
        const validationErrors = validateSchedule();
        if (validationErrors.length > 0) {
            showNotification('Plan indirilmeden önce aşağıdaki hatalar düzeltilmelidir:', 'error', true, validationErrors);
            return;
        }

        const shuffleBtnCell = document.getElementById('shuffle-button-cell');
        const downloadBtnCell = document.getElementById('download-button-cell');

        if (shuffleBtnCell) shuffleBtnCell.style.visibility = 'hidden';
        if (downloadBtnCell) downloadBtnCell.style.visibility = 'hidden';

        try {
            const canvas = await html2canvas(table, {
                scale: 2,
                logging: true,
                useCORS: true,
                onclone: (clonedDocument) => {
                    // Render selects as text
                    const selects = clonedDocument.querySelectorAll('select');
                    selects.forEach(select => {
                        const optionText = select.options[select.selectedIndex].text;
                        const textSpan = clonedDocument.createElement('span');
                        textSpan.textContent = optionText;
                        
                        const computedStyle = window.getComputedStyle(select);
                        for (let i = 0; i < computedStyle.length; i++) {
                            const prop = computedStyle[i];
                            textSpan.style[prop] = computedStyle[prop];
                        }
                        textSpan.style.display = 'inline-block';
                        textSpan.style.width = select.offsetWidth + 'px';
                        textSpan.style.height = select.offsetHeight + 'px';
                        textSpan.style.lineHeight = select.offsetHeight + 'px';
                        textSpan.style.textAlign = 'center';
                        textSpan.style.backgroundColor = computedStyle.backgroundColor;
                        textSpan.style.border = computedStyle.border;
                        textSpan.style.borderRadius = computedStyle.borderRadius;
                        textSpan.style.backgroundImage = 'none'; // Ensure no arrow on cloned selects
                        textSpan.style.padding = computedStyle.padding;
                        // For the '=' symbol, ensure it's visually centered and bold
                        if (optionText === '=') {
                            textSpan.style.fontWeight = 'bolder';
                            textSpan.style.fontSize = '1.2em';
                        }
                        select.parentNode.replaceChild(textSpan, select);
                    });

                    // Render checkboxes as Unicode characters
                    const checkboxes = clonedDocument.querySelectorAll('input[type="checkbox"]');
                    checkboxes.forEach(checkbox => {
                        const cell = checkbox.closest('td');
                        if (cell) {
                            const displaySpan = clonedDocument.createElement('span');
                            displaySpan.style.display = 'block';
                            displaySpan.style.width = '100%';
                            displaySpan.style.height = '100%';
                            displaySpan.style.textAlign = 'center';
                            displaySpan.style.lineHeight = '1';
                            displaySpan.style.fontSize = '1.2em';
                            displaySpan.style.display = 'flex';
                            displaySpan.style.alignItems = 'center';
                            displaySpan.style.justifyContent = 'center';


                            if (checkbox.checked) {
                                displaySpan.textContent = '✔';
                                displaySpan.style.color = '#4CAF50';
                                displaySpan.style.fontWeight = 'bold';
                            } else {
                                displaySpan.textContent = '☐';
                                displaySpan.style.color = '#ccc';
                            }
                            checkbox.parentNode.replaceChild(displaySpan, checkbox);
                        }
                    });
                }
            });

            const link = document.createElement('a');
            link.download = 'haftalik_plan.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
            showNotification('Tablo PNG olarak indirildi!', 'success');
        } catch (error) {
            console.error('Error capturing table:', error);
            showNotification('Tablo indirilirken bir hata oluştu!', 'error');
        } finally {
            if (shuffleBtnCell) shuffleBtnCell.style.visibility = 'visible';
            if (downloadBtnCell) downloadBtnCell.style.visibility = 'visible';
        }
    };

    const showNotification = (message, type, isList = false, items = []) => {
        notification.innerHTML = ''; // Clear previous content
        notification.style.display = 'block';
        
        const heading = document.createElement('p');
        heading.textContent = message;
        heading.style.fontWeight = 'bold';
        notification.appendChild(heading);

        if (isList && items.length > 0) {
            const ul = document.createElement('ul');
            items.forEach(item => {
                const li = document.createElement('li');
                li.textContent = item;
                ul.appendChild(li);
            });
            notification.appendChild(ul);
        }

        if (type === 'success') {
            notification.style.backgroundColor = '#d4edda';
            notification.style.color = '#155724';
            notification.style.borderColor = '#c3e6cb';
        } else if (type === 'error') {
            notification.style.backgroundColor = '#f8d7da';
            notification.style.color = '#721c24';
            notification.style.borderColor = '#f5c6cb';
        }
        setTimeout(() => {
            notification.style.display = 'none';
        }, 8000); // Increased timeout for reading errors
    };

    // Event Listeners
    shuffleButton.addEventListener('click', shuffleSchedule);
    downloadButton.addEventListener('click', downloadTableAsPng);

    // Initial setup
    // Call loadSchedule first, it will call initializeSchedule if no saved data
    loadSchedule(); 
});