import {
  useMemo,
  useState,
} from "react";

import { useToast } from "../../context/ToastContext";

import PageTitle from "./PageTitle";
import Card from "./Card";
import Input from "./Input";
import Button from "./Button";
import DataTable from "./DataTable";
import ConfirmDialog from "./ConfirmDialog";
import Modal from "../modal/Modal";

export default function MasterPage({
  title,
  subtitle,
  sectionTitle,
  sectionDescription,
  searchPlaceholder = "Cari data...",
  addButtonText = "+ Tambah Data",
  editButtonText = "Edit",
  deleteButtonText = "Hapus",
  columns = [],
  data = [],
  FormComponent,
  onSave,
  onUpdate,
  onDelete,
  getItemLabel,
  canEdit = true,
  canDelete = true,
  emptyMessage = "Belum ada data",
}) {
  const toast = useToast();

  const [search, setSearch] =
    useState("");

  const [formMode, setFormMode] =
    useState(null);

  const [selectedItem, setSelectedItem] =
    useState(null);

  const [deleteItem, setDeleteItem] =
    useState(null);

  const [saving, setSaving] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [formError, setFormError] =
    useState("");

  /*
   * ============================
   * FILTER + SORT
   * ============================
   */
  const filteredData = useMemo(() => {
    const keyword =
      search.trim().toLowerCase();

    const isInactive = (item) => {
      const status = String(
        item.status || ""
      )
        .trim()
        .toLowerCase();

      return [
        "nonaktif",
        "tidak aktif",
        "inactive",
        "disabled",
      ].includes(status);
    };

    const sortedData = [...data].sort(
      (a, b) =>
        Number(isInactive(a)) -
        Number(isInactive(b))
    );

    if (!keyword) {
      return sortedData;
    }

    return sortedData.filter((item) =>
      Object.values(item).some(
        (value) => {
          if (
            value === null ||
            value === undefined
          ) {
            return false;
          }

          if (
            typeof value === "object"
          ) {
            return false;
          }

          return String(value)
            .toLowerCase()
            .includes(keyword);
        }
      )
    );
  }, [data, search]);

  /*
   * ============================
   * ACTION COLUMN
   * ============================
   */
  const actionColumn = useMemo(() => {
    if (!onUpdate && !onDelete) {
      return null;
    }

    return {
      key: "__actions",

      title: "Aksi",

      render: (item) => (
        <div className="flex flex-wrap gap-2">
          {onUpdate &&
            canEdit && (
              <Button
                onClick={() =>
                  handleOpenEdit(
                    item
                  )
                }
                disabled={
                  saving ||
                  deleting
                }
                className="!bg-[#E8EDE2] !text-[#5F6F4F] shadow-sm hover:!bg-[#DCE4D3] hover:!text-[#4F5F42]"
              >
                {
                  editButtonText
                }
              </Button>
            )}

          {onDelete &&
            canDelete && (
              <Button
                onClick={() =>
                  setDeleteItem(
                    item
                  )
                }
                disabled={
                  saving ||
                  deleting
                }
                className="!bg-[#F3E2DF] !text-[#9A625B] shadow-sm hover:!bg-[#EAD3CF] hover:!text-[#87534D]"
              >
                {
                  deleteButtonText
                }
              </Button>
            )}
        </div>
      ),
    };
  }, [
    onUpdate,
    onDelete,
    canEdit,
    canDelete,
    editButtonText,
    deleteButtonText,
    saving,
    deleting,
  ]);

  const tableColumns = useMemo(
    () =>
      actionColumn
        ? [
            ...columns,
            actionColumn,
          ]
        : columns,
    [
      columns,
      actionColumn,
    ]
  );

  /*
   * ============================
   * OPEN CREATE
   * ============================
   */
  function handleOpenCreate() {
    setSelectedItem(null);
    setFormError("");
    setFormMode("create");
  }

  /*
   * ============================
   * OPEN EDIT
   * ============================
   */
  function handleOpenEdit(item) {
    setSelectedItem(item);
    setFormError("");
    setFormMode("edit");
  }

  /*
   * ============================
   * CLOSE FORM
   * ============================
   */
  function handleCloseForm() {
    if (saving) {
      return;
    }

    setFormError("");
    setSelectedItem(null);
    setFormMode(null);
  }

  /*
   * ============================
   * FORM SUBMIT
   * ============================
   *
   * PurchaseForm mengirim payload
   * melalui onSave().
   *
   * Di sini baru kita tentukan:
   *
   * CREATE → onSave(payload)
   *
   * EDIT → onUpdate(selectedItem,
   *                 payload)
   */
  async function handleSubmit(
    item
  ) {
    if (saving) {
      return;
    }

    try {
      setSaving(true);
      setFormError("");

      /*
       * ========================
       * EDIT
       * ========================
       */
      if (formMode === "edit") {
        if (!onUpdate) {
          throw new Error(
            "Fungsi update belum tersedia."
          );
        }

        await onUpdate(
          selectedItem,
          item
        );

        toast.success(
          `${
            sectionTitle ||
            "Data"
          } berhasil diperbarui.`
        );
      }

      /*
       * ========================
       * CREATE
       * ========================
       */
      else {
        if (!onSave) {
          throw new Error(
            "Fungsi simpan belum tersedia."
          );
        }

        await onSave(item);

        toast.success(
          `${
            sectionTitle ||
            "Data"
          } berhasil disimpan.`
        );
      }

      /*
       * Tutup modal setelah
       * operasi berhasil.
       */
      setSelectedItem(null);
      setFormMode(null);
    } catch (error) {
      console.error(
        "Gagal menyimpan data:",
        error
      );

      const message =
        error?.message ||
        "Data gagal disimpan.";

      setFormError(message);

      toast.error(message);

      /*
       * Jangan throw lagi ke
       * PurchaseForm.
       *
       * MasterPage sudah menangani
       * error di sini.
       */
    } finally {
      setSaving(false);
    }
  }

  /*
   * ============================
   * DELETE
   * ============================
   */
  async function handleConfirmDelete() {
    if (
      !deleteItem ||
      !onDelete ||
      deleting
    ) {
      return;
    }

    try {
      setDeleting(true);

      await onDelete(
        deleteItem
      );

      toast.success(
        `${
          sectionTitle ||
          "Data"
        } berhasil dihapus.`
      );

      setDeleteItem(null);
    } catch (error) {
      console.error(
        "Gagal menghapus data:",
        error
      );

      const message =
        error?.message ||
        "Data gagal dihapus.";

      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }

  /*
   * ============================
   * DELETE LABEL
   * ============================
   */
  const deleteLabel =
    deleteItem
      ? getItemLabel?.(
          deleteItem
        ) ||
        deleteItem.nama ||
        deleteItem.kode ||
        deleteItem.tanggal ||
        "data ini"
      : "data ini";

  /*
   * ============================
   * RENDER
   * ============================
   */
  return (
    <div>
      <PageTitle
        title={title}
        subtitle={subtitle}
      />

      <Card>
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-800">
            {sectionTitle}
          </h2>

          {sectionDescription && (
            <p className="mt-1 text-sm text-gray-500">
              {
                sectionDescription
              }
            </p>
          )}
        </div>

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-sm">
            <Input
              placeholder={
                searchPlaceholder
              }
              value={search}
              onChange={(
                event
              ) =>
                setSearch(
                  event.target
                    .value
                )
              }
              disabled={
                saving ||
                deleting
              }
            />
          </div>

          {FormComponent &&
            onSave && (
              <Button
                onClick={
                  handleOpenCreate
                }
                disabled={
                  saving ||
                  deleting
                }
              >
                {
                  addButtonText
                }
              </Button>
            )}
        </div>

        <DataTable
          columns={
            tableColumns
          }
          data={
            filteredData
          }
          emptyMessage={
            emptyMessage
          }
        />
      </Card>

      /*
       * ==========================
       * FORM MODAL
       * ==========================
       */
      {FormComponent && (
        <Modal
          open={Boolean(
            formMode
          )}
          onClose={
            handleCloseForm
          }
        >
          {formError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {
                formError
              }
            </div>
          )}

          <FormComponent
            key={
              selectedItem?.id ||
              formMode ||
              "form"
            }
            initialData={
              formMode ===
              "edit"
                ? selectedItem
                : null
            }
            mode={formMode}
            onSave={
              handleSubmit
            }
            onCancel={
              handleCloseForm
            }
            saving={saving}
          />
        </Modal>
      )}

      /*
       * ==========================
       * DELETE CONFIRMATION
       * ==========================
       */
      <ConfirmDialog
        open={Boolean(
          deleteItem
        )}
        title={`Hapus ${
          sectionTitle ||
          "Data"
        }`}
        message={`Apakah Anda yakin ingin menghapus ${deleteLabel}? Data akan disembunyikan dari sistem, tetapi riwayatnya tetap tersimpan.`}
        confirmText="Ya, Hapus"
        loading={deleting}
        onConfirm={
          handleConfirmDelete
        }
        onCancel={() => {
          if (!deleting) {
            setDeleteItem(
              null
            );
          }
        }}
      />
    </div>
  );
}