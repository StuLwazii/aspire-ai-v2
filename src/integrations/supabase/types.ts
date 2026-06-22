export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agents: {
        Row: {
          created_at: string
          current_ticket_count: number
          department: string
          email: string
          full_name: string
          id: string
          status: Database["public"]["Enums"]["agent_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          current_ticket_count?: number
          department: string
          email: string
          full_name: string
          id?: string
          status?: Database["public"]["Enums"]["agent_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          current_ticket_count?: number
          department?: string
          email?: string
          full_name?: string
          id?: string
          status?: Database["public"]["Enums"]["agent_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      app_users: {
        Row: {
          created_at: string
          department: string
          email: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          department: string
          email: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          department?: string
          email?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      business_reports: {
        Row: {
          created_at: string
          created_by: string | null
          department: string
          executive_summary: string
          html: string
          id: string
          kpis: Json
          performance_analysis: string
          period_end: string
          period_start: string
          recommendations: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department?: string
          executive_summary: string
          html: string
          id?: string
          kpis?: Json
          performance_analysis: string
          period_end: string
          period_start: string
          recommendations: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department?: string
          executive_summary?: string
          html?: string
          id?: string
          kpis?: Json
          performance_analysis?: string
          period_end?: string
          period_start?: string
          recommendations?: string
          title?: string
        }
        Relationships: []
      }
      compliance_logs: {
        Row: {
          compliance_status: string
          created_at: string
          id: string
          identified_risks: Json
          prompt: string
          response: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level: string
          risk_score: number
          source: string
          transparency_notes: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          compliance_status?: string
          created_at?: string
          id?: string
          identified_risks?: Json
          prompt: string
          response: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string
          risk_score?: number
          source?: string
          transparency_notes?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          compliance_status?: string
          created_at?: string
          id?: string
          identified_risks?: Json
          prompt?: string
          response?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string
          risk_score?: number
          source?: string
          transparency_notes?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          message: string
          role: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          role: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          role?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      report_schedules: {
        Row: {
          active: boolean
          cadence: string
          created_at: string
          created_by: string | null
          department: string
          id: string
          last_run_at: string | null
          name: string
          next_run_at: string | null
          recipients: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          cadence?: string
          created_at?: string
          created_by?: string | null
          department?: string
          id?: string
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          recipients?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          cadence?: string
          created_at?: string
          created_by?: string | null
          department?: string
          id?: string
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          recipients?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          admin_notes: string | null
          ai_response: string | null
          assigned_agent_id: string | null
          category: Database["public"]["Enums"]["ticket_category"]
          classification_method: string
          created_at: string
          escalation_reason: string | null
          first_response_at: string | null
          id: string
          message: string
          priority: Database["public"]["Enums"]["ticket_priority"]
          rating: Database["public"]["Enums"]["ticket_rating"] | null
          resolution_type: Database["public"]["Enums"]["resolution_type"]
          resolved_at: string | null
          resolved_by_user: boolean
          status: Database["public"]["Enums"]["ticket_status"]
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          ai_response?: string | null
          assigned_agent_id?: string | null
          category: Database["public"]["Enums"]["ticket_category"]
          classification_method?: string
          created_at?: string
          escalation_reason?: string | null
          first_response_at?: string | null
          id?: string
          message: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          rating?: Database["public"]["Enums"]["ticket_rating"] | null
          resolution_type?: Database["public"]["Enums"]["resolution_type"]
          resolved_at?: string | null
          resolved_by_user?: boolean
          status?: Database["public"]["Enums"]["ticket_status"]
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          ai_response?: string | null
          assigned_agent_id?: string | null
          category?: Database["public"]["Enums"]["ticket_category"]
          classification_method?: string
          created_at?: string
          escalation_reason?: string | null
          first_response_at?: string | null
          id?: string
          message?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          rating?: Database["public"]["Enums"]["ticket_rating"] | null
          resolution_type?: Database["public"]["Enums"]["resolution_type"]
          resolved_at?: string | null
          resolved_by_user?: boolean
          status?: Database["public"]["Enums"]["ticket_status"]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      agent_status: "available" | "busy" | "offline"
      app_role: "admin" | "user" | "agent"
      resolution_type: "self_service" | "escalated" | "pending"
      ticket_category: "HR" | "IT" | "Finance" | "Operations"
      ticket_priority: "low" | "medium" | "high" | "critical"
      ticket_rating: "up" | "down"
      ticket_status: "open" | "in_progress" | "resolved" | "escalated"
      ticket_tone: "formal" | "friendly" | "urgent"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agent_status: ["available", "busy", "offline"],
      app_role: ["admin", "user", "agent"],
      resolution_type: ["self_service", "escalated", "pending"],
      ticket_category: ["HR", "IT", "Finance", "Operations"],
      ticket_priority: ["low", "medium", "high", "critical"],
      ticket_rating: ["up", "down"],
      ticket_status: ["open", "in_progress", "resolved", "escalated"],
      ticket_tone: ["formal", "friendly", "urgent"],
    },
  },
} as const
