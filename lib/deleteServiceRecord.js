// lib/deleteServiceRecord.js
import { supabase } from "./supabaseClient";

export async function deleteServiceRecordFull(serviceRecordId) {
  if (!serviceRecordId) throw new Error("Missing serviceRecordId");

  const { error } = await supabase.rpc(
    "delete_service_record_full",
    { p_service_record_id: serviceRecordId }
  );

  if (error) {
    console.error("Delete service record failed", error);
    throw error;
  }
}
