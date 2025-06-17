window.Ai8vPlus = (function() {     
    'use strict';

    const ISSUE_COST = {
        ORPHAN: { points: 100, label: 'أولوية قصوى', icon: 'bi-exclamation-diamond-fill', color: 'danger' },
        BROKEN_LINK: { points: 50, label: 'أولوية عالية', icon: 'bi-unlink', color: 'danger' },
        NO_H1: { points: 25, label: 'أولوية متوسطة', icon: 'bi-heading', color: 'warning' },
        NO_DESCRIPTION: { points: 15, label: 'أولوية متوسطة', icon: 'bi-card-text', color: 'warning' },
        MISSING_ALT: { points: 10, label: 'تحسين', icon: 'bi-image-alt', color: 'info' },
        LOW_WORD_COUNT: { points: 5, label: 'للمراجعة', icon: 'bi-file-earmark-word', color: 'info' }
    };

    /**
     * Helper function for correct Arabic pluralization.
     * @param {number} count The number of items.
     * @returns {string} The formatted plural string (e.g., "صفحة واحدة", "5 صفحات").
     */
    function getArabicPluralText(count) {
        if (count === 1) return 'صفحة واحدة';
        if (count === 2) return 'صفحتان';
        if (count >= 3 && count <= 10) return `${count} صفحات`;
        return `${count} صفحة`;
    }

    /**
     * Analyzes the search index and generates an actionable task list.
     * @param {Array} searchIndex - The search index array from the main state.
     * @returns {Array} An array of task objects, sorted by priority.
     */
    function analyzeAndPrioritize(searchIndex) {
        if (!searchIndex || searchIndex.length === 0) {
            return [];
        }

        const tasks = {};

        const addTask = (issueType, page) => {
            if (!tasks[issueType]) {
                tasks[issueType] = {
                    id: issueType,
                    description: '',
                    details: [],
                    priority: ISSUE_COST[issueType]
                };
            }
            tasks[issueType].details.push({ title: page.title, url: page.url });
        };

        searchIndex.forEach(page => {
            if (!page.seo) return;

            if (page.seo.isOrphan) addTask('ORPHAN', page);
            if (page.seo.brokenLinksOnPage?.length > 0) addTask('BROKEN_LINK', page);
            if (!page.seo.h1) addTask('NO_H1', page);
            if (page.seo.isDefaultDescription) addTask('NO_DESCRIPTION', page);
            if (page.seo.imageAltInfo?.missing > 0) addTask('MISSING_ALT', page);
            if (page.seo.wordCount < 100) addTask('LOW_WORD_COUNT', page);
        });

        const taskList = Object.values(tasks).map(task => {
            const countText = getArabicPluralText(task.details.length);

            switch (task.id) {
                case 'ORPHAN':
                    task.description = `إصلاح ${countText} معزولة لا يمكن الوصول إليها.`;
                    break;
                case 'BROKEN_LINK':
                    task.description = `إصلاح روابط مكسورة في ${countText}.`;
                    break;
                case 'NO_H1':
                    task.description = `إضافة عنوان رئيسي (H1) إلى ${countText}.`;
                    break;
                case 'NO_DESCRIPTION':
                    task.description = `كتابة وصف ميتا فريد لـ ${countText}.`;
                    break;
                case 'MISSING_ALT':
                    task.description = `إضافة نص بديل (alt text) لصور في ${countText}.`;
                    break;
                case 'LOW_WORD_COUNT':
                    task.description = `مراجعة محتوى ${countText} لأنه قليل الكلمات.`;
                    break;
            }
            return task;
        });

        return taskList.sort((a, b) => b.priority.points - a.priority.points);
    }

    return {
        analyzeAndPrioritize
    };

})();