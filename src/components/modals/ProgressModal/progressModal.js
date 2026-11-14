import { ref, toRef, watchEffect } from 'vue';

/** `withStatus`: key results also carry a manual status (measurements do not). */
export function useProgressModal(props, emit, { withStatus = false } = {}) {
  const record = toRef(props.record);
  const loading = ref(false);
  const thisRecord = ref({});

  watchEffect(() => {
    if (record.value) {
      const { value, comment, timestamp, status, statusNote } = record.value;
      thisRecord.value = {
        value,
        comment: comment || '',
        timestamp: timestamp.toDate(),
        // '' = computed automatically
        status: status || '',
        statusNote: statusNote || '',
      };
    } else {
      thisRecord.value = {
        value: null,
        comment: '',
        timestamp: new Date(),
        status: '',
        statusNote: '',
      };
    }
  });

  function saveRecord() {
    loading.value = true;

    const data = { ...thisRecord.value };
    if (withStatus) {
      // The reason only goes with a status set by hand.
      data.statusNote = data.status ? (data.statusNote || '').trim() : '';
    } else {
      delete data.status;
      delete data.statusNote;
    }

    if (record.value) {
      emit('update-record', record.value.id, data, close);
    } else {
      emit('create-record', data, close);
    }
  }

  function deleteRecord() {
    if (record.value) {
      loading.value = true;
      emit('delete-record', record.value.id, close);
    }
  }

  function close(e) {
    loading.value = false;
    emit('close', e);
  }

  return { thisRecord, loading, saveRecord, deleteRecord, close };
}

export default useProgressModal;
