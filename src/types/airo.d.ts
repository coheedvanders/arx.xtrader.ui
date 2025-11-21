export {};
import { useViewStore } from "@/stores/entityViewStore";

declare global {
  interface Window {
    AIRO: {
      Page?: {
        goTo: (path) => void;
      };
      Action?:{
        save: (id) => void;
        saveSnap: (id) => void;
        delete: (id) => void;
        activate: (id) => void;
        deactivate: (id) => void;
        tag: (id) => void;
        share: (id) => void;
      };
      viewStore?: ReturnType<typeof useViewStore>;
      [key: string]: any;
      View?: {
        getSelectedRecordId: () => void;
        getSelectedViewRecordId: (viewId) => any;
        getSelectedRow: () => any;
        getSelectedRows: () => any;
        getVisibleRows: () => any;
        setRowTextColor: (rowId) => void;
        setRowBackColor: (rowId) => void;
      };
      Form?: {
        formData: () => any;
        snapFormData: () => any;
        showCreateSnapForm(entityName,snapFormGuid): () => void;
        showEditSnapForm(entityName,snapFormGuid,recordId): () => void;
      }
      Notification?: any;
    };
  }
}