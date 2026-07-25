import {
  useEffect,
  useState,
} from "react";

import MasterPage from "../../components/ui/MasterPage";
import StatusBadge from "../../components/ui/StatusBadge";
import LoadingState from "../../components/ui/LoadingState";
import SupplierForm from "../../components/forms/SupplierForm";

import { useToast } from "../../context/ToastContext";

import {
  createSupplier,
  getAllSuppliers,
  softDeleteSupplier,
  updateSupplier,
} from "../../services/supplierService";

export default function Suppliers() {
  const [suppliers, setSuppliers] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [pageError, setPageError] =
    useState("");

  const toast = useToast();

  useEffect(() => {
    async function loadSuppliers() {
      try {
        setPageError("");

        const data =
          await getAllSuppliers();

        setSuppliers(data);
      } catch (error) {
        console.error(
          "Gagal mengambil supplier:",
          error
        );

        const message =
          error.message ||
          "Data supplier gagal dimuat.";

        setPageError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    }

    loadSuppliers();
  }, [toast]);

  const columns = [
    {
      key: "kode",
      title: "Kode",
    },
    {
      key: "nama",
      title: "Nama Supplier",
    },
    {
      key: "kontak",
      title: "Kontak",
      render: (supplier) =>
        supplier.kontak || "-",
    },
    {
      key: "telepon",
      title: "Telepon",
      render: (supplier) =>
        supplier.telepon || "-",
    },
    {
      key: "email",
      title: "Email",
      render: (supplier) =>
        supplier.email || "-",
    },
    {
      key: "alamat",
      title: "Alamat",
      render: (supplier) =>
        supplier.alamat || "-",
    },
    {
      key: "status",
      title: "Status",
      render: (supplier) => (
        <StatusBadge
          status={supplier.status}
        />
      ),
    },
  ];

  async function handleCreateSupplier(
    supplier
  ) {
    const savedSupplier =
      await createSupplier(supplier);

    setSuppliers((previous) =>
      [...previous, savedSupplier].sort(
        (a, b) =>
          a.nama.localeCompare(
            b.nama,
            "id"
          )
      )
    );

    return savedSupplier;
  }

  async function handleUpdateSupplier(
    selectedSupplier,
    values
  ) {
    const updatedSupplier =
      await updateSupplier(
        selectedSupplier.id,
        values
      );

    setSuppliers((previous) =>
      previous
        .map((item) =>
          item.id === updatedSupplier.id
            ? updatedSupplier
            : item
        )
        .sort((a, b) =>
          a.nama.localeCompare(
            b.nama,
            "id"
          )
        )
    );

    return updatedSupplier;
  }

  async function handleDeleteSupplier(
    supplier
  ) {
    await softDeleteSupplier(
      supplier.id
    );

    setSuppliers((previous) =>
      previous.filter(
        (item) =>
          item.id !== supplier.id
      )
    );
  }

  if (loading) {
    return (
      <LoadingState message="Memuat data supplier..." />
    );
  }

  return (
    <div>
      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <MasterPage
        title="Supplier"
        subtitle="Kelola master supplier Bunbun Kitchen"
        sectionTitle="Supplier"
        sectionDescription="Data pemasok bahan baku dan kebutuhan operasional"
        searchPlaceholder="Cari supplier..."
        addButtonText="+ Tambah Supplier"
        columns={columns}
        data={suppliers}
        FormComponent={SupplierForm}
        onSave={
          handleCreateSupplier
        }
        onUpdate={
          handleUpdateSupplier
        }
        onDelete={
          handleDeleteSupplier
        }
        getItemLabel={(item) =>
          `"${item.kode} — ${item.nama}"`
        }
        emptyMessage="Belum ada supplier"
      />
    </div>
  );
}