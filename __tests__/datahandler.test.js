/**
 * @jest-environment jsdom
 */

const scriptModules = require('../assets/js/script.js');
const { DataHandler, StateManager, Analyzer: AnalyzerForDataHandler } = scriptModules;
// لا نستورد UIManager مباشرة هنا لأننا سنقوم بعمل spy عليه عبر scriptModules

describe('DataHandler Module', () => {
    let getFilterStateSpy; // عرّف الـ spy هنا ليكون متاحًا في النطاق

    beforeEach(() => {
        StateManager.resetAppState();

        // تأكد أن UIManager و getFilterState موجودان قبل عمل spy
        if (scriptModules.UIManager && typeof scriptModules.UIManager.getFilterState === 'function') {
            // أنشئ الـ spy (أو أعد إنشائه إذا لزم الأمر) وقم بتعيين تطبيق mock
            getFilterStateSpy = jest.spyOn(scriptModules.UIManager, 'getFilterState').mockImplementation(() => ({
                category: '',
                keyword: '',
                isOrphan: false
            }));
        } else {
            // هذا الشرط يجب ألا يتحقق إذا كان script.js يُصدّر UIManager بشكل صحيح
            // وإذا كان UIManager يحتوي على دالة getFilterState.
            // إذا حدث هذا، فهناك مشكلة أعمق في تصدير UIManager من script.js
            console.error("UIManager أو UIManager.getFilterState غير موجود في scriptModules عند محاولة عمل spy.");
            // يمكنك اختيار رمي خطأ هنا إذا كان هذا يعتبر حالة فشل حرجة للاختبارات
            // throw new Error('UIManager or getFilterState is not available for spying.');
        }
    });

    afterEach(() => {
        // أعد الدالة الأصلية بعد كل اختبار إذا تم إنشاء الـ spy
        if (getFilterStateSpy) {
            getFilterStateSpy.mockRestore();
        }
    });
    
    describe('addItemsToIndex', () => {
        it('should add new items to the search index and assign unique IDs', () => {
            const items = [
                { title: 'Page 1', url: '/page1.html', description: 'Desc 1', category: 'Cat A', tags: ['t1'] },
                { title: 'Page 2', url: '/page2.html', description: 'Desc 2', category: 'Cat B', tags: ['t2'] }
            ];
            const addedCount = DataHandler.addItemsToIndex(items);
            expect(addedCount).toBe(2);
            expect(StateManager.appState.searchIndex.length).toBe(2);
            expect(StateManager.appState.searchIndex[0].id).toBe(1);
            expect(StateManager.appState.searchIndex[0].title).toBe('Page 1');
            expect(StateManager.appState.searchIndex[1].id).toBe(2);
            expect(StateManager.appState.searchIndex[1].title).toBe('Page 2');
        });

        it('should not add items with duplicate URLs, considering normalization', () => {
            DataHandler.addItemsToIndex([{ title: 'Original Page', url: '/page1.html' }]);
            const newItems = [
                { title: 'Duplicate Page', url: '/page1.html' }, 
                { title: 'Duplicate with slash', url: '/page1.html/' }, 
                { title: 'New Page', url: '/page2.html' }
            ];
            const addedCount = DataHandler.addItemsToIndex(newItems);
            expect(addedCount).toBe(1); 
            expect(StateManager.appState.searchIndex.length).toBe(2);
            const titles = StateManager.appState.searchIndex.map(item => item.title);
            expect(titles).toContain('Original Page');
            expect(titles).toContain('New Page');
            expect(titles).not.toContain('Duplicate Page');
            expect(titles).not.toContain('Duplicate with slash');
        });

        it('should correctly increment IDs for new items', () => {
            DataHandler.addItemsToIndex([{ title: 'A', url: '/a' }]); 
            DataHandler.addItemsToIndex([{ title: 'B', url: '/b' }]); 
            DataHandler.addItemsToIndex([{ title: 'C', url: '/c' }]); 
            expect(StateManager.appState.searchIndex.find(i => i.title === 'A').id).toBe(1);
            expect(StateManager.appState.searchIndex.find(i => i.title === 'B').id).toBe(2);
            expect(StateManager.appState.searchIndex.find(i => i.title === 'C').id).toBe(3);
        });
    });

    describe('generateSearchIndexFromInputs', () => {
        let originalExtractTags;
        beforeAll(() => {
            if (AnalyzerForDataHandler && typeof AnalyzerForDataHandler.extractTagsFromUrl === 'function') {
                originalExtractTags = AnalyzerForDataHandler.extractTagsFromUrl;
                AnalyzerForDataHandler.extractTagsFromUrl = jest.fn((url) => [`tag_for_${url.replace(/\//g, '')}`]);
            }
        });
        afterAll(() => { 
            if (originalExtractTags) {
                AnalyzerForDataHandler.extractTagsFromUrl = originalExtractTags;
            }
        });

        it('should generate items from URL input value', () => {
            const urlInputValue = "page1.html\n/page2.html";
            const newItems = DataHandler.generateSearchIndexFromInputs(urlInputValue, false);
            expect(newItems.length).toBe(2);
            expect(newItems[0].url).toBe('/page1.html');
            expect(newItems[0].title).toBe('Page1');
            expect(newItems[1].url).toBe('/page2.html');
            if (AnalyzerForDataHandler && typeof AnalyzerForDataHandler.extractTagsFromUrl.mock !== 'undefined') {
                expect(AnalyzerForDataHandler.extractTagsFromUrl).toHaveBeenCalledWith('/page1.html');
                expect(AnalyzerForDataHandler.extractTagsFromUrl).toHaveBeenCalledWith('/page2.html');
            }
        });

        it('should include manual pages if isManualChecked is true', () => {
            StateManager.appState.manualPages = [
                { title: 'Manual Page', url: '/manual', description: 'Manual Desc', category: 'Manual Cat', tags: ['m_tag'] }
            ];
            const newItems = DataHandler.generateSearchIndexFromInputs("", true);
            expect(newItems.length).toBe(1);
            expect(newItems[0].title).toBe('Manual Page');
            expect(newItems[0].source).toBe('manual');
        });

        it('should include analyzed files', () => {
            StateManager.appState.analyzedFiles = [
                { filename: 'analyzed.html', title: 'Analyzed File', url: '/analyzed.html', description: 'Analyzed Desc', keywords: ['a_key'], source: 'html_analysis' }
            ];
            const newItems = DataHandler.generateSearchIndexFromInputs("", false);
            expect(newItems.length).toBe(1);
            expect(newItems[0].title).toBe('Analyzed File');
            expect(newItems[0].source).toBe('html_analysis');
            expect(newItems[0].tags).toEqual(['a_key']);
        });

        it('should prioritize analyzed files over URL input for same URL', () => {
            StateManager.appState.analyzedFiles = [
                { filename: 'page1.html', title: 'Analyzed Page 1', url: '/page1.html', source: 'html_analysis' }
            ];
            DataHandler.addItemsToIndex(StateManager.appState.analyzedFiles);
            const urlInputValue = "page1.html\npage2.html";
            const newItemsFromInput = DataHandler.generateSearchIndexFromInputs(urlInputValue, false);
            expect(newItemsFromInput.length).toBe(1); 
            expect(newItemsFromInput[0].url).toBe('/page2.html');
        });
    });

    describe('addManualPage', () => {
        it('should add a page to manualPages array, prepending slash to URL if needed', () => {
            const pageData1 = { title: 'M1', url: 'm1.html', description: 'D1', category: 'C1', tags: ['t1'] };
            const pageData2 = { title: 'M2', url: '/m2.html', description: 'D2', category: 'C2', tags: ['t2'] };
            DataHandler.addManualPage(pageData1);
            DataHandler.addManualPage(pageData2);
            expect(StateManager.appState.manualPages.length).toBe(2);
            expect(StateManager.appState.manualPages[0].url).toBe('/m1.html');
            expect(StateManager.appState.manualPages[1].url).toBe('/m2.html');
            expect(StateManager.appState.manualPages[0].category).toBe('C1');
        });
    });

    describe('getSelectedItems', () => {
        it('should return all items from searchIndex if no items are selected and no filters active', () => {
            const items = [
                { id: 1, title: 'Page 1', url: '/page1.html' },
                { id: 2, title: 'Page 2', url: '/page2.html' }
            ];
            DataHandler.addItemsToIndex(items);
            StateManager.appState.selectedItemIds.clear();
            const selected = DataHandler.getSelectedItems(); 
            expect(selected.length).toBe(2);
            expect(selected.map(i => i.id)).toEqual([1, 2]);
            // التأكد من أن الـ spy تم استدعاؤه
            expect(getFilterStateSpy).toHaveBeenCalledTimes(1); 
        });

        it('should return only selected items from searchIndex if items are selected', () => {
             const items = [
                { id: 1, title: 'Page 1', url: '/page1.html' },
                { id: 2, title: 'Page 2', url: '/page2.html' },
                { id: 3, title: 'Page 3', url: '/page3.html' }
            ];
            DataHandler.addItemsToIndex(items);
            StateManager.appState.selectedItemIds.add(1);
            StateManager.appState.selectedItemIds.add(3);
            const selected = DataHandler.getSelectedItems();
            expect(selected.length).toBe(2);
            expect(selected.map(i => i.id)).toEqual(expect.arrayContaining([1, 3]));
            expect(getFilterStateSpy).toHaveBeenCalledTimes(1);
        });

        it('should use filteredResults if filters are active (mocked)', () => {
            // غيّر قيمة الـ mock لهذا الاختبار فقط
            getFilterStateSpy.mockReturnValueOnce({ 
                category: 'TestCat', 
                keyword: 'test', 
                isOrphan: true 
            });

            StateManager.appState.searchIndex = [
                { id: 1, title: 'Page Test', url: '/page1.html', category: 'TestCat', seo: { isOrphan: true } },
                { id: 2, title: 'Another Page', url: '/page2.html', category: 'OtherCat', seo: { isOrphan: false } }
            ];
            StateManager.appState.filteredResults = [StateManager.appState.searchIndex[0]]; 
            const selected = DataHandler.getSelectedItems();
            expect(selected.length).toBe(1);
            expect(selected[0].id).toBe(1);
            expect(getFilterStateSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('deleteItem', () => {
        global.confirm = jest.fn(() => true); 
        const onCompleteMock = jest.fn();

        beforeEach(() => {
            global.confirm.mockClear();
            onCompleteMock.mockClear();
        });

        it('should delete an item from searchIndex and filteredResults if confirmed', () => {
            DataHandler.addItemsToIndex([
                { id: 1, title: 'To Delete', url: '/delete' },
                { id: 2, title: 'To Keep', url: '/keep' }
            ]);
            StateManager.appState.filteredResults = [...StateManager.appState.searchIndex]; 
            StateManager.appState.selectedItemIds.add(1);
            DataHandler.deleteItem(1, onCompleteMock);
            expect(global.confirm).toHaveBeenCalledWith('هل أنت متأكد من حذف العنصر:\n"To Delete"');
            expect(StateManager.appState.searchIndex.length).toBe(1);
            expect(StateManager.appState.searchIndex[0].title).toBe('To Keep');
            expect(StateManager.appState.filteredResults.length).toBe(1);
            expect(StateManager.appState.filteredResults[0].title).toBe('To Keep');
            expect(StateManager.appState.selectedItemIds.has(1)).toBe(false);
            expect(onCompleteMock).toHaveBeenCalledTimes(1);
        });

        it('should not delete if item ID does not exist', () => {
            DataHandler.addItemsToIndex([{ id: 1, title: 'Exists', url: '/exists' }]);
            DataHandler.deleteItem(99, onCompleteMock); 
            expect(global.confirm).not.toHaveBeenCalled();
            expect(StateManager.appState.searchIndex.length).toBe(1);
            expect(onCompleteMock).not.toHaveBeenCalled();
        });

        it('should not delete if user cancels confirmation', () => {
            global.confirm.mockReturnValueOnce(false); 
            DataHandler.addItemsToIndex([{ id: 1, title: 'Not Deleted', url: '/not-deleted' }]);
            DataHandler.deleteItem(1, onCompleteMock);
            expect(global.confirm).toHaveBeenCalled();
            expect(StateManager.appState.searchIndex.length).toBe(1);
            expect(onCompleteMock).not.toHaveBeenCalled();
        });
    });
});